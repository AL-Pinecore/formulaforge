use image::ImageEncoder;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri_plugin_dialog::DialogExt;

const MAX_DIMENSION: f32 = 16384.0;
const MAX_PIXELS: f64 = 16_777_216.0; // 4096 x 4096
const MAX_SVG_BYTES: usize = 4 * 1024 * 1024;
const MAX_CONCURRENT_EXPORTS: usize = 2;

static ACTIVE_EXPORTS: AtomicUsize = AtomicUsize::new(0);
static TMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

struct ExportGuard;

impl ExportGuard {
    fn acquire() -> Result<Self, ExportError> {
        let previous = ACTIVE_EXPORTS.fetch_add(1, Ordering::SeqCst);
        if previous >= MAX_CONCURRENT_EXPORTS {
            ACTIVE_EXPORTS.fetch_sub(1, Ordering::SeqCst);
            return Err(ExportError::Busy);
        }
        Ok(Self)
    }
}

impl Drop for ExportGuard {
    fn drop(&mut self) {
        ACTIVE_EXPORTS.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("unsupported export format: {0}")]
    UnsupportedFormat(String),
    #[error("the SVG document is empty")]
    EmptySvg,
    #[error("the SVG document is too large (max {MAX_SVG_BYTES} bytes)")]
    SvgTooLarge,
    #[error("the SVG document is invalid: {0}")]
    InvalidSvg(String),
    #[error("the SVG document contains unsafe content: {0}")]
    UnsafeSvg(String),
    #[error(
        "the exported image is too large (max {0}x{0} px and {1} total pixels)",
        MAX_DIMENSION as u64,
        MAX_PIXELS as u64
    )]
    TooLarge,
    #[error("another export is already running, please wait a moment")]
    Busy,
    #[error("failed to write file: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to encode image: {0}")]
    Encode(String),
    #[error("failed to create PDF: {0}")]
    Pdf(String),
    #[error("invalid export path")]
    InvalidPath,
    #[error("failed to read file: {0}")]
    Read(String),
    #[error("nothing to save")]
    EmptyText,
}

impl serde::Serialize for ExportError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportApprovedRequest {
    pub format: String,
    pub svg: String,
    pub jpeg_quality: Option<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextApprovedRequest {
    pub contents: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Svg,
    Png,
    Jpeg,
    Webp,
    Pdf,
}

impl Format {
    fn parse(value: &str) -> Result<Self, ExportError> {
        match value.to_ascii_lowercase().as_str() {
            "svg" => Ok(Self::Svg),
            "png" => Ok(Self::Png),
            "jpeg" | "jpg" => Ok(Self::Jpeg),
            "webp" => Ok(Self::Webp),
            "pdf" => Ok(Self::Pdf),
            other => Err(ExportError::UnsupportedFormat(other.to_string())),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Webp => "webp",
            Self::Pdf => "pdf",
        }
    }

    fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::Svg => &["svg"],
            Self::Png => &["png"],
            Self::Jpeg => &["jpg", "jpeg"],
            Self::Webp => &["webp"],
            Self::Pdf => &["pdf"],
        }
    }

    fn filter_name(self) -> &'static str {
        match self {
            Self::Svg => "SVG image",
            Self::Png => "PNG image",
            Self::Jpeg => "JPEG image",
            Self::Webp => "WebP image",
            Self::Pdf => "PDF document",
        }
    }

    fn matches_extension(self, extension: Option<&str>) -> bool {
        match extension {
            Some(ext) => {
                let ext = ext.to_ascii_lowercase();
                self.extensions().iter().any(|allowed| *allowed == ext)
            }
            None => false,
        }
    }
}

// The save dialog and filesystem I/O live in Rust so the webview never needs
// (and is never granted) arbitrary path access. Commands are async so the
// blocking dialog and the (CPU-heavy) SVG rendering run off the main thread
// instead of freezing the UI.
#[tauri::command]
pub async fn export_equation_approved(
    app: tauri::AppHandle,
    request: ExportApprovedRequest,
) -> Result<Option<String>, ExportError> {
    let format = Format::parse(&request.format)?;
    let svg = validate_svg(&request.svg)?.to_string();
    let file = app
        .dialog()
        .file()
        .set_file_name(format!("equation.{}", format.extension()))
        .add_filter(format.filter_name(), format.extensions());
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<tauri_plugin_dialog::FilePath>>(1);
    file.save_file(move |path| {
        let _ = tx.try_send(path);
    });
    let Some(path) = rx.recv().await.flatten() else {
        return Ok(None);
    };
    let path = path.as_path().ok_or(ExportError::InvalidPath)?;
    let path = normalize_extension(path.to_path_buf(), format);
    let saved = path.display().to_string();
    let guard = ExportGuard::acquire()?;
    let jpeg_quality = request.jpeg_quality;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        export_to_path(&path, format, &svg, jpeg_quality)
    })
    .await
    .map_err(|e| ExportError::Read(e.to_string()))??;
    Ok(Some(saved))
}

#[tauri::command]
pub async fn save_text_file_approved(
    app: tauri::AppHandle,
    request: SaveTextApprovedRequest,
) -> Result<Option<String>, ExportError> {
    if request.contents.is_empty() {
        return Err(ExportError::EmptyText);
    }
    let file = app
        .dialog()
        .file()
        .set_file_name("equation.tex")
        .add_filter("LaTeX file", &["tex", "latex"]);
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<tauri_plugin_dialog::FilePath>>(1);
    file.save_file(move |path| {
        let _ = tx.try_send(path);
    });
    let Some(path) = rx.recv().await.flatten() else {
        return Ok(None);
    };
    let path = path.as_path().ok_or(ExportError::InvalidPath)?;
    let path = ensure_tex_extension(path.to_path_buf());
    write_atomic(&path, request.contents.as_bytes())?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn read_text_file_approved(app: tauri::AppHandle) -> Result<Option<String>, ExportError> {
    let file = app
        .dialog()
        .file()
        .add_filter("LaTeX file", &["tex", "latex"])
        .add_filter("Text file", &["txt"]);
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<tauri_plugin_dialog::FilePath>>(1);
    file.pick_file(move |path| {
        let _ = tx.try_send(path);
    });
    let Some(path) = rx.recv().await.flatten() else {
        return Ok(None);
    };
    let contents = std::fs::read_to_string(path.as_path().ok_or(ExportError::InvalidPath)?)
        .map_err(|e| ExportError::Read(e.to_string()))?;
    Ok(Some(contents))
}

fn ensure_tex_extension(mut path: PathBuf) -> PathBuf {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("tex") || ext.eq_ignore_ascii_case("latex") => path,
        _ => {
            path.set_extension("tex");
            path
        }
    }
}

fn normalize_extension(mut path: PathBuf, format: Format) -> PathBuf {
    match path.extension() {
        Some(_) if format.matches_extension(path.extension().and_then(|s| s.to_str())) => path,
        Some(_) => {
            path.set_extension(format.extension());
            path
        }
        None => {
            path.set_extension(format.extension());
            path
        }
    }
}

fn validate_svg(svg: &str) -> Result<&str, ExportError> {
    let svg = svg.trim();
    if svg.is_empty() {
        return Err(ExportError::EmptySvg);
    }
    if svg.len() > MAX_SVG_BYTES {
        return Err(ExportError::SvgTooLarge);
    }
    let lower = svg.to_ascii_lowercase();
    if lower.contains("<script") {
        return Err(ExportError::UnsafeSvg(
            "script elements are not allowed".to_string(),
        ));
    }
    if lower.contains("onload=")
        || lower.contains("onclick=")
        || lower.contains("onerror=")
        || lower.contains("onmouseover=")
        || lower.contains("onfocus=")
    {
        return Err(ExportError::UnsafeSvg(
            "event handler attributes are not allowed".to_string(),
        ));
    }
    if lower.contains("href=\"http")
        || lower.contains("href=\"file")
        || lower.contains("href=\"javascript")
        || lower.contains("href=\"//")
    {
        return Err(ExportError::UnsafeSvg(
            "external link references are not allowed".to_string(),
        ));
    }
    Ok(svg)
}

fn export_to_path(
    path: &Path,
    format: Format,
    svg: &str,
    jpeg_quality: Option<u8>,
) -> Result<(), ExportError> {
    let bytes = match format {
        Format::Svg => svg.as_bytes().to_vec(),
        Format::Pdf => svg_to_pdf(svg)?,
        Format::Png | Format::Jpeg | Format::Webp => svg_to_raster(svg, format, jpeg_quality)?.0,
    };
    write_atomic(path, &bytes)?;
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), ExportError> {
    let parent = path.parent().ok_or(ExportError::InvalidPath)?;
    let file_name = path.file_name().ok_or(ExportError::InvalidPath)?;
    let sequence = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(
        ".{}.tmp{}-{}",
        file_name.to_string_lossy(),
        std::process::id(),
        sequence
    ));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(())
}

fn check_size(width: f32, height: f32) -> Result<(), ExportError> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(ExportError::InvalidSvg(
            "the SVG has no usable dimensions".to_string(),
        ));
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(ExportError::TooLarge);
    }
    if f64::from(width) * f64::from(height) > MAX_PIXELS {
        return Err(ExportError::TooLarge);
    }
    Ok(())
}

fn svg_to_pdf(svg: &str) -> Result<Vec<u8>, ExportError> {
    // Deny loading images from the local filesystem; only data: URLs may resolve.
    let opts = svg2pdf::usvg::Options {
        image_href_resolver: svg2pdf::usvg::ImageHrefResolver {
            resolve_data: svg2pdf::usvg::ImageHrefResolver::default_data_resolver(),
            resolve_string: Box::new(|_href: &str, _opts: &svg2pdf::usvg::Options| None),
        },
        ..Default::default()
    };
    let tree = svg2pdf::usvg::Tree::from_str(svg, &opts)
        .map_err(|e| ExportError::InvalidSvg(e.to_string()))?;
    let size = tree.size();
    check_size(size.width(), size.height())?;
    let page = svg2pdf::PageOptions::default();
    svg2pdf::to_pdf(&tree, svg2pdf::ConversionOptions::default(), page)
        .map_err(|e| ExportError::Pdf(e.to_string()))
}

fn svg_to_raster(
    svg: &str,
    format: Format,
    jpeg_quality: Option<u8>,
) -> Result<(Vec<u8>, u32, u32), ExportError> {
    // Deny loading images from the local filesystem; only data: URLs may resolve.
    let opts = resvg::usvg::Options {
        image_href_resolver: resvg::usvg::ImageHrefResolver {
            resolve_data: resvg::usvg::ImageHrefResolver::default_data_resolver(),
            resolve_string: Box::new(|_href: &str, _opts: &resvg::usvg::Options| None),
        },
        ..Default::default()
    };
    let tree = resvg::usvg::Tree::from_str(svg, &opts)
        .map_err(|e| ExportError::InvalidSvg(e.to_string()))?;
    let size = tree.size();
    check_size(size.width(), size.height())?;

    let width_px = size.width().ceil() as u32;
    let height_px = size.height().ceil() as u32;

    let mut pixmap =
        resvg::tiny_skia::Pixmap::new(width_px, height_px).ok_or(ExportError::TooLarge)?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );

    // tiny-skia stores premultiplied alpha; encoders expect straight RGBA.
    let pixel_count = (width_px as usize) * (height_px as usize);
    let mut straight = Vec::with_capacity(pixel_count * 4);
    for pixel in pixmap.pixels().iter() {
        let color = pixel.demultiply();
        straight.extend_from_slice(&[color.red(), color.green(), color.blue(), color.alpha()]);
    }

    let mut out = Vec::new();
    match format {
        Format::Png => {
            let encoder = image::codecs::png::PngEncoder::new(&mut out);
            encoder
                .write_image(
                    &straight,
                    width_px,
                    height_px,
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| ExportError::Encode(e.to_string()))?;
        }
        Format::Jpeg => {
            let quality = jpeg_quality.unwrap_or(90).clamp(1, 100);
            let rgb = composite_over_white(&straight);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
            encoder
                .write_image(&rgb, width_px, height_px, image::ExtendedColorType::Rgb8)
                .map_err(|e| ExportError::Encode(e.to_string()))?;
        }
        Format::Webp => {
            let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut out);
            encoder
                .write_image(
                    &straight,
                    width_px,
                    height_px,
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| ExportError::Encode(e.to_string()))?;
        }
        _ => unreachable!(),
    }
    Ok((out, width_px, height_px))
}

fn composite_over_white(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for pixel in rgba.as_chunks::<4>().0 {
        let alpha = u32::from(pixel[3]);
        if alpha == 255 {
            rgb.extend_from_slice(&pixel[..3]);
        } else {
            let inverse = 255 - alpha;
            for channel in &pixel[..3] {
                let value = (u32::from(*channel) * alpha + 255 * inverse) / 255;
                rgb.push(value as u8);
            }
        }
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40"><rect width="100" height="40" fill="white"/><path d="M10 30 L50 10 L90 30" stroke="black" fill="none"/></svg>"#;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("formulaforge-test-{}-{}", std::process::id(), name))
    }

    #[test]
    fn format_parsing() {
        assert_eq!(Format::parse("png").unwrap(), Format::Png);
        assert_eq!(Format::parse("JPEG").unwrap(), Format::Jpeg);
        assert_eq!(Format::parse("jpg").unwrap(), Format::Jpeg);
        assert!(Format::parse("bmp").is_err());
    }

    #[test]
    fn extension_is_appended() {
        let path = normalize_extension(PathBuf::from("/tmp/no-extension"), Format::Png);
        assert_eq!(path.extension().unwrap(), "png");
    }

    #[test]
    fn mismatched_extension_is_replaced() {
        let path = normalize_extension(PathBuf::from("/tmp/equation.pdf"), Format::Png);
        assert_eq!(path.extension().unwrap(), "png");
    }

    #[test]
    fn tex_extension_is_enforced() {
        let path = ensure_tex_extension(PathBuf::from("/tmp/equation.txt"));
        assert_eq!(path.extension().unwrap(), "tex");
        let path = ensure_tex_extension(PathBuf::from("/tmp/equation.latex"));
        assert_eq!(path.extension().unwrap(), "latex");
        let path = ensure_tex_extension(PathBuf::from("/tmp/equation"));
        assert_eq!(path.extension().unwrap(), "tex");
    }

    #[test]
    fn matching_extension_is_kept() {
        let path = normalize_extension(PathBuf::from("/tmp/equation.JPG"), Format::Jpeg);
        assert_eq!(path.extension().unwrap(), "JPG");
    }

    #[test]
    fn exports_png_with_expected_signature() {
        let path = temp_path("png");
        export_to_path(&path, Format::Png, TEST_SVG, None).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn png_has_expected_dimensions() {
        let (bytes, w, h) = svg_to_raster(TEST_SVG, Format::Png, None).unwrap();
        assert_eq!((w, h), (100, 40));
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn jpeg_and_webp_encode() {
        let (jpeg, _, _) = svg_to_raster(TEST_SVG, Format::Jpeg, Some(75)).unwrap();
        assert_eq!(&jpeg[..2], b"\xff\xd8");
        let (webp, _, _) = svg_to_raster(TEST_SVG, Format::Webp, None).unwrap();
        assert_eq!(&webp[..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
    }

    #[test]
    fn svg_passthrough() {
        let path = temp_path("svg");
        export_to_path(&path, Format::Svg, TEST_SVG, None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), TEST_SVG);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn pdf_has_signature() {
        let pdf = svg_to_pdf(TEST_SVG).unwrap();
        assert_eq!(&pdf[..5], b"%PDF-");
    }

    #[test]
    fn renders_real_mathjax_svg() {
        // Fixture generated from a real MathJax 4 render of a complex equation.
        let svg = include_str!("../tests/fixtures/mathjax-eq.svg");
        let (png, width, height) = svg_to_raster(svg, Format::Png, None).unwrap();
        assert!(width > 10 && height > 10);
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");

        let (jpeg, _, _) = svg_to_raster(svg, Format::Jpeg, Some(90)).unwrap();
        assert_eq!(&jpeg[..2], b"\xff\xd8");

        let (webp, _, _) = svg_to_raster(svg, Format::Webp, None).unwrap();
        assert_eq!(&webp[..4], b"RIFF");

        let pdf = svg_to_pdf(svg).unwrap();
        assert_eq!(&pdf[..5], b"%PDF-");
    }
    #[test]
    fn semi_transparent_pixels_are_straight_alpha() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" viewBox="0 0 2 2"><rect width="2" height="2" fill="red" fill-opacity="0.5"/></svg>"#;
        let (png, _, _) = svg_to_raster(svg, Format::Png, None).unwrap();
        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
        let pixel = decoded.to_rgba8().get_pixel(0, 0).0;
        assert!(
            (126..=129).contains(&pixel[3]),
            "alpha should be about 127, got {}",
            pixel[3]
        );
        assert!(
            pixel[0] > 200,
            "red channel should stay near straight red, got {}",
            pixel[0]
        );
    }

    #[test]
    fn invalid_svg_is_rejected() {
        assert!(svg_to_raster("not svg at all", Format::Png, None).is_err());
        assert!(svg_to_pdf("not svg at all").is_err());
    }

    #[test]
    fn oversized_svg_is_rejected() {
        let huge = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100" viewBox="0 0 100000 100"><rect width="100000" height="100"/></svg>"#;
        assert!(matches!(
            svg_to_raster(huge, Format::Png, None),
            Err(ExportError::TooLarge)
        ));
    }

    #[test]
    fn oversized_svg_bytes_are_rejected() {
        let big = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\">{}</svg>",
            "x".repeat(MAX_SVG_BYTES + 1)
        );
        assert!(matches!(validate_svg(&big), Err(ExportError::SvgTooLarge)));
    }

    #[test]
    fn unsafe_svg_is_rejected() {
        let script = r#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;
        assert!(matches!(
            validate_svg(script),
            Err(ExportError::UnsafeSvg(_))
        ));
        let event = r#"<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>"#;
        assert!(matches!(
            validate_svg(event),
            Err(ExportError::UnsafeSvg(_))
        ));
        let link = r#"<a xmlns="http://www.w3.org/2000/svg" href="http://example.com">x</a>"#;
        assert!(matches!(validate_svg(link), Err(ExportError::UnsafeSvg(_))));
    }

    #[test]
    fn local_image_references_are_denied() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10" viewBox="0 0 10 10"><image xlink:href="file:///etc/passwd" width="10" height="10"/></svg>"#;
        assert!(validate_svg(svg).is_err());
        // A relative/absolute local path is ignored by the deny-all resolver:
        // the export still succeeds but never embeds the local file.
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10" viewBox="0 0 10 10"><image xlink:href="/etc/passwd" width="10" height="10"/></svg>"#;
        let (png, _, _) = svg_to_raster(svg, Format::Png, None).unwrap();
        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
        let rgba = decoded.to_rgba8();
        // The denied image must not contribute any non-transparent pixels.
        assert!(rgba.pixels().all(|pixel| pixel.0 == [0, 0, 0, 0]));
    }

    #[test]
    fn empty_svg_is_rejected() {
        assert!(matches!(validate_svg("   "), Err(ExportError::EmptySvg)));
    }

    #[test]
    fn unsupported_format_is_rejected() {
        assert!(matches!(
            Format::parse("bmp"),
            Err(ExportError::UnsupportedFormat(_))
        ));
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let path = temp_path("atomic");
        std::fs::write(&path, b"old contents").unwrap();
        write_atomic(&path, b"new contents").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new contents");
        let parent = path.parent().unwrap();
        let marker = format!(
            ".{}.tmp{}",
            path.file_name().unwrap().to_string_lossy(),
            std::process::id()
        );
        let leftovers: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(&marker))
            .collect();
        assert!(leftovers.is_empty(), "no temp files should remain");
        std::fs::remove_file(&path).unwrap();
    }
}
