# Fixtures for v2.7 V18 (engine/__tests__/barsFromDrawing.test.ts), drawn by R:
# base barplot() through pdf() and cairo_pdf(), and ggplot2's geom_col() through
# pdf(). One series of known heights; the test checks the drawn heights are in
# the data's proportions, so no calibration is needed.
#   Rscript make_bars.R
suppressMessages(library(ggplot2))
here <- dirname(normalizePath(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))))
h <- c(3.25, 5.10, 2.40, 6.75)
pdf(file.path(here, "bars-rbase.pdf"), 5, 3.75); barplot(h, col = "#1f77b4", border = "#1f77b4"); dev.off()
cairo_pdf(file.path(here, "bars-rcairo.pdf"), 5, 3.75); barplot(h, col = "#1f77b4", border = NA); dev.off()
p <- ggplot(data.frame(c = factor(1:4), h = h), aes(c, h)) + geom_col(fill = "#1f77b4") + theme_bw()
pdf(file.path(here, "bars-rgg.pdf"), 5, 3.75); print(p); dev.off()
invisible(NULL)
