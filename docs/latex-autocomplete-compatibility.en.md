# Backslash Autocomplete Compatibility Blocklist

MathLive 0.110's backslash completion includes MathLive-specific aliases, commands that require optional packages, and commands that the project's MathJax 4 configuration cannot recognize. FormulaForge disables 262 such candidates so previews, exports, and common online renderers do not receive unreliable LaTeX.

## Audit rule

The audit covers the command candidates exposed by MathLive's completion popover across every alphabetic prefix. Each candidate passes through `normalizePortableLatex()` before being rendered with the bundled MathJax 4 TeX-SVG configuration. A candidate is disabled only when its normalized output is still rendered as an unknown command.

This is a conservative portability baseline. Some commands may work in a full TeX distribution, KaTeX, or MathJax with an optional package, but they are unreliable in FormulaForge's default rendering path. MathLive commands that FormulaForge already converts to mainstream notation, such as `\degree` and `\differentialD`, are not blocked.

Disabled items are discarded when completion is confirmed with `Enter` / `Tab` or clicked in the suggestion popover. MathLive currently has no public per-command popover filter, so their names may still be visible in the popover.

## Disabled commands

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

The authoritative runtime list is `app/utils/latex-autocomplete.ts`. The end-to-end test renders every entry with MathJax and verifies both keyboard and click rejection, so a renderer upgrade that makes an existing entry available requires this list to be updated.
