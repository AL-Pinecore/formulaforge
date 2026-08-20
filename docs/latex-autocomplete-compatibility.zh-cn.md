# 反斜杠补全兼容性禁用表

MathLive 0.110 的反斜杠补全包含 MathLive 专有别名、依赖额外宏包的命令，以及项目当前 MathJax 4 配置无法识别的命令。为避免生成预览、导出和常见在线渲染器无法稳定处理的 LaTeX，FormulaForge 禁用了其中 262 个候选项。

## 判定方式

检查覆盖 MathLive 补全弹窗按全部字母前缀呈现的命令候选项。每个候选项先经过 `normalizePortableLatex()`，再交给项目内置的 MathJax 4 TeX-SVG 渲染；规范化后仍被渲染成红色未知命令的候选项进入禁用表。

这是一条保守的可移植性基线：部分命令在完整 TeX 发行版、KaTeX 或加载特定扩展宏包后可能可用，但在 FormulaForge 的默认渲染链路中不可靠。已经被项目转换为通用写法的 MathLive 命令（如 `\degree`、`\differentialD`）不在禁用表内。

禁用项在按 `Enter` / `Tab` 确认或点击补全弹窗时会被丢弃，不会进入公式。MathLive 暂无逐命令过滤补全弹窗的公开 API，因此这些名称仍可能出现在弹窗中。

## 禁用命令

```text
A: \Alpha  \Approxcolon
B: \backdoubleprime  \Beta  \bfseries  \biconditional  \biginterleave  \bm  \bold  \boxast  \boxbar  \boxbox  \boxbslash  \boxcircle  \boxslash  \bull
C: \c  \C  \ch  \Chi  \clubs  \cnums  \Colon  \colonapprox  \Colonapprox  \coloncolon  \coloncolonapprox  \coloncolonequals  \coloncolonminus  \coloncolonsim  \colondash  \Colondash  \coloneq  \Coloneq  \coloneqq  \Coloneqq  \colonequals  \colonminus  \colonsim  \Colonsim  \Complex  \coppa  \Coppa  \cosec  \cotg  \ctg  \cth
D: \dag  \Dagger  \darr  \dArr  \Darr  \dashcolon  \Dashcolon  \dblcolon  \ddag  \diamonds  \differencedelta  \divides  \doubleprime  \doubleStruckCapitalN  \doubleStruckCapitalP  \doubleStruckCapitalQ  \doubleStruckCapitalR  \doubleStruckCapitalZ
E: \em  \emph  \empty  \enskip  \ensuremath  \Epsilon  \eqcolon  \Eqcolon  \eqdef  \eqqcolon  \Eqqcolon  \equalscolon  \equalscoloncolon  \error  \Eta  \euro  \exist
F: \fatsemi  \fontfamily  \fontseries  \fontshape
G: \gothicCapitalC  \gothicCapitalH  \gothicCapitalI  \gothicCapitalR
H: \H  \harr  \hArr  \Harr  \hearts  \htmlClass  \htmlData  \htmlId  \htmlStyle
I: \image  \imageof  \infin  \intclockwise  \intctrclockwise  \interleave  \Iota  \isin
K: \Kappa  \koppa  \Koppa
L: \lang  \laplace  \Laplace  \larr  \lArr  \Larr  \lb  \Lbag  \leftarrowtriangle  \leftrightarrowtriangle  \leftslice  \lightning  \llbracket  \longleftrightarrows  \longLeftrightharpoons  \longmapsfrom  \Longmapsfrom  \Longmapsto  \longrightleftharpoons  \longRightleftharpoons  \lparen  \lrarr  \lrArr  \Lrarr
M: \mapsfrom  \Mapsfrom  \MapsTo  \mathellipsis  \mathllap  \mathrlap  \mdseries  \measeq  \minuscolon  \minuscoloncolon  \Mu  \mvert  \mVert
N: \N  \natnums  \nicefrac  \nor  \notni  \nsubset  \nsupset  \Nu  \nvrightarrow  \nvrightarrowtail  \nvtwoheadrightarrow  \nvtwoheadrightarrowtail
O: \odif  \ointctrclockwise  \Omicron  \ordinarycolon  \originalof  \overarc  \overgroup  \overleftharpoon  \overlinesegment  \Overrightarrow  \overrightharpoon
P: \parallelogram  \part  \pdiff  \phase  \plim  \plusmn  \pounds
Q: \Q  \questeq
R: \R  \raisebox  \rang  \rarr  \rArr  \Rarr  \ratio  \Rbag  \rd  \rD  \real  \reals  \Reals  \Rho  \rightarrowtriangle  \rightslice  \rmfamily  \roundimplies  \rparen  \rrbracket
S: \sampi  \Sampi  \scriptCapitalE  \scriptCapitalH  \scriptCapitalL  \scshape  \sdot  \sect  \selectfont  \sffamily  \sh  \simcolon  \Simcolon  \simcoloncolon  \slshape  \spades  \sslash  \sub  \sube  \supe
T: \talloblong  \Tau  \textmd  \textsc  \textsl  \tg  \th  \the  \thetasym  \ttfamily  \twoheadrightarrowtail
U: \uarr  \uArr  \Uarr  \underarc  \undergroup  \underlinesegment  \upshape  \utilde
V: \varcoppa  \varointclockwise  \vcentcolon
W: \weierp  \widecheck  \wideparen
X: \xhookleftarrow  \xhookrightarrow  \xLeftarrow  \xleftharpoondown  \xleftharpoonup  \xleftrightarrow  \xLeftrightarrow  \xleftrightarrows  \xleftrightharpoons  \xLeftrightharpoons  \xRightarrow  \xrightharpoondown  \xrightharpoonup  \xrightleftharpoons  \xRightleftharpoons
Y: \Yup
Z: \Z  \Zeta
```

权威运行时列表位于 `app/utils/latex-autocomplete.ts`；端到端测试会逐项交给 MathJax 检查并验证键盘、鼠标禁用入口，升级渲染器后若已有命令变为可用，测试会要求同步更新此表。
