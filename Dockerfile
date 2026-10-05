# Two stages: build the site with Node, then serve it with nginx.
# The final image contains only static files and nginx — no Node, no source,
# and no study data.
#
# The snapshot is NOT baked in. It is mounted at runtime (see compose.yaml), so
# the image holds nothing sensitive and refreshing the data does not mean
# rebuilding the image.

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so edits to source do not re-run npm ci on every build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- serve ----------------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The snapshot is mounted here at runtime. Without it the dashboard reports
# that the data file is missing rather than failing silently.
RUN mkdir -p /usr/share/nginx/html/admin/data

EXPOSE 80

# 127.0.0.1 rather than localhost: nginx listens on IPv4 only, and localhost
# resolves to ::1 first inside the container, which would always fail.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
