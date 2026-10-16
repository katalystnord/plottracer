# Fixtures for v2.7 V22, the reverse check, drawn by R itself: base graphics
# through pdf() and cairo_pdf(), and ggplot2 through pdf(). Same truth format
# as make_reverse.py; every position comes from R's own coordinate conversion
# (base: grconvertX/Y to ndc; ggplot2: the panel viewport's device location),
# so none is read off the file.
#
#   Rscript make_reverse.R
suppressMessages(library(ggplot2))
library(grid)
library(jsonlite)
here <- dirname(normalizePath(sub("--file=", "", grep("--file=", commandArgs(FALSE), value = TRUE))))
set.seed(22003)
W <- 5; H <- 3.75

curve <- function(n) {
  x <- round(seq(0.5, 9.5, length.out = n), 2)
  a <- runif(3, -1, 1)
  cbind(x, round(5 + 2.5 * a[1] * sin(x / (1.2 + a[2])) + 0.25 * a[3] * x, 2))
}
scatter <- function(n) cbind(round(sort(runif(n, 0.5, 9.5)), 2), round(runif(n, 1, 9), 2))
rgb255 <- function(h) as.integer(col2rgb(h)[, 1])
pg <- function(nx, ny) cbind(round(nx * W * 72, 4), round(ny * H * 72, 4)) # ndc -> page points, y up
write_truth <- function(name, gen, box, calib, series)
  write_json(list(generator = gen, digits = 2, box = box, calib = calib, series = series),
             file.path(here, paste0(name, ".truth.json")), auto_unbox = TRUE, digits = NA, matrix = "rowmajor")

COLS <- c("#1f77b4", "#d62728")

base <- function(dev, name, what) {
  ds <- lapply(COLS, function(c) if (what == "markers") scatter(20) else curve(if (what == "line") 30 else 15))
  info <- NULL
  draw <- function() {
    par(mar = c(4, 4, 1, 1))
    plot(NA, xlim = c(0, 10), ylim = c(0, 10), xlab = "x", ylab = "y")
    for (i in seq_along(COLS)) {
      d <- ds[[i]]
      if (what != "markers") lines(d[, 1], d[, 2], col = COLS[i], lwd = 1.5)
      if (what != "line") points(d[, 1], d[, 2], col = COLS[i], pch = 16, cex = 0.7)
    }
    u <- par("usr"); xt <- axTicks(1); yt <- axTicks(2)
    nx <- function(v) grconvertX(v, "user", "ndc"); ny <- function(v) grconvertY(v, "user", "ndc")
    info <<- list(
      box = c(pg(nx(u[1]), ny(u[3])), pg(nx(u[2]), ny(u[4]))),
      calib = list(x = lapply(range(xt), function(v) c(v, pg(nx(v), 0)[1])), y = lapply(range(yt), function(v) c(v, pg(0, ny(v))[2]))))
  }
  if (dev == "cairo") cairo_pdf(file.path(here, paste0(name, ".pdf")), W, H) else pdf(file.path(here, paste0(name, ".pdf")), W, H)
  draw(); dev.off()
  drawn <- c(line = "line", markers = "markers", linemarkers = "line+markers")[[what]]
  write_truth(name, paste0("R ", R.version$major, ".", R.version$minor, " ", if (dev == "cairo") "cairo_pdf()" else "pdf()"), info$box, info$calib,
              lapply(seq_along(COLS), function(i) list(drawn = drawn, colour = rgb255(COLS[i]), data = ds[[i]])))
}

gg <- function(name, what) {
  ds <- lapply(COLS, function(c) if (what == "markers") scatter(20) else curve(if (what == "line") 30 else 15))
  df <- do.call(rbind, lapply(seq_along(COLS), function(i) data.frame(x = ds[[i]][, 1], y = ds[[i]][, 2], s = COLS[i])))
  p <- ggplot(df, aes(x, y, colour = s, group = s)) + scale_colour_identity() + theme_bw()
  if (what != "markers") p <- p + geom_line(linewidth = 0.6)
  if (what != "line") p <- p + geom_point(size = 1.2)
  info <- NULL
  pdf(file.path(here, paste0(name, ".pdf")), W, H)
  grid.newpage(); grid.draw(ggplotGrob(p)); grid.force()
  pp <- ggplot_build(p)$layout$panel_params[[1]]
  vpn <- grid.ls(viewports = TRUE, grobs = FALSE, print = FALSE)$name
  downViewport(grep("^panel\\.", vpn, value = TRUE)[1])
  loc <- function(x, y) {
    a <- deviceLoc(unit((x - pp$x.range[1]) / diff(pp$x.range), "npc"), unit((y - pp$y.range[1]) / diff(pp$y.range), "npc"), valueOnly = TRUE)
    cbind(round(a$x * 72, 4), round(a$y * 72, 4)) # inches -> points, y up
  }
  xt <- pp$x$breaks[!is.na(pp$x$breaks)]; yt <- pp$y$breaks[!is.na(pp$y$breaks)]
  info <- list(box = c(loc(pp$x.range[1], pp$y.range[1]), loc(pp$x.range[2], pp$y.range[2])),
               calib = list(x = lapply(range(xt), function(v) c(v, loc(v, pp$y.range[1])[1])), y = lapply(range(yt), function(v) c(v, loc(pp$x.range[1], v)[2]))))
  upViewport(0)
  dev.off()
  drawn <- c(line = "line", markers = "markers", linemarkers = "line+markers")[[what]]
  write_truth(name, paste0("ggplot2 ", packageVersion("ggplot2"), " pdf()"), info$box, info$calib,
              lapply(seq_along(COLS), function(i) list(drawn = drawn, colour = rgb255(COLS[i]), data = ds[[i]])))
}

for (dev in c("base", "cairo")) for (w in c("line", "markers", "linemarkers")) base(dev, sprintf("reverse-r%s-%s", dev, w), w)
for (w in c("line", "markers", "linemarkers")) gg(sprintf("reverse-rgg-%s", w), w)
cat("written\n")
