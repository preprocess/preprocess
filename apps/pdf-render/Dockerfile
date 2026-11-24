# The PDF page renderer's sandbox (design doc 07): poppler's pdftoppm on Debian.
# No network at run time; the container only reads the PDF from stdin.
FROM debian:trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 render
USER render
# Nothing listens; local `wrangler dev` refuses an image without a port.
EXPOSE 8080
CMD ["sleep", "infinity"]
