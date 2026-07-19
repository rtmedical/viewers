#!/bin/sh
# shellcheck disable=SC2016

set -eu

TEMPLATE_DIR="${NGINX_TEMPLATE_DIR:-/usr/src}"
NGINX_CONFIG_FILE="${NGINX_CONFIG_FILE:-/etc/nginx/conf.d/default.conf}"
HTML_ROOT="${NGINX_HTML_ROOT:-/usr/share/nginx/html}"
VIEWER_DIST_DIR="${VIEWER_DIST_DIR:-/usr/share/nginx/viewer-dist}"
PUBLIC_URL_BUILD_FILE="${PUBLIC_URL_BUILD_FILE:-/usr/share/nginx/viewer-public-url}"
PORT="${PORT:-80}"
PUBLIC_URL="${PUBLIC_URL:-/}"

case "$PUBLIC_URL" in
  *\?*|*\#*|*\\*|*[[:space:]]*)
    echo "PUBLIC_URL must not include a query string, hash, backslash, or whitespace" >&2
    exit 1
    ;;
  //*)
    echo "PUBLIC_URL protocol-relative URLs are not supported" >&2
    exit 1
    ;;
  [hH][tT][tT][pP]://*|[hH][tT][tT][pP][sS]://*)
    url_without_scheme="${PUBLIC_URL#*://}"
    case "$url_without_scheme" in
      */*) PUBLIC_PATH="/${url_without_scheme#*/}" ;;
      *) PUBLIC_PATH="/" ;;
    esac
    ;;
  *:*)
    echo "PUBLIC_URL must use HTTP(S) or be an absolute path" >&2
    exit 1
    ;;
  *)
    PUBLIC_PATH="$PUBLIC_URL"
    ;;
esac

if [ -f "$PUBLIC_URL_BUILD_FILE" ]; then
  BUILT_PUBLIC_URL="$(cat "$PUBLIC_URL_BUILD_FILE")"
  if [ "$PUBLIC_URL" != "$BUILT_PUBLIC_URL" ]; then
    echo "PUBLIC_URL must match the value used to build this image ($BUILT_PUBLIC_URL)" >&2
    exit 1
  fi
fi

while [ "${PUBLIC_PATH#/}" != "$PUBLIC_PATH" ]; do
  PUBLIC_PATH="${PUBLIC_PATH#/}"
done
PUBLIC_PATH="/$PUBLIC_PATH"
while [ "$PUBLIC_PATH" != "/" ] && [ "${PUBLIC_PATH%/}" != "$PUBLIC_PATH" ]; do
  PUBLIC_PATH="${PUBLIC_PATH%/}"
done
if [ "$PUBLIC_PATH" != "/" ]; then
  PUBLIC_PATH="$PUBLIC_PATH/"
fi
PUBLIC_PATH_BASE="${PUBLIC_PATH%/}"
if [ "$PUBLIC_PATH" = "/" ]; then
  PUBLIC_PATH_REDIRECT=""
else
  PUBLIC_PATH_REDIRECT="location = $PUBLIC_PATH_BASE { return 308 $PUBLIC_PATH; }"
fi
export PORT PUBLIC_PATH PUBLIC_PATH_REDIRECT

APP_ROOT="${HTML_ROOT}${PUBLIC_PATH_BASE}"
mkdir -p "$APP_ROOT"
cp -R "$VIEWER_DIST_DIR"/. "$APP_ROOT"/

if [ -n "${SSL_PORT:-}" ]; then
  envsubst '${SSL_PORT}:${PORT}' < "$TEMPLATE_DIR/default.ssl.conf.template" |
    envsubst '${PUBLIC_PATH}:${PUBLIC_PATH_REDIRECT}' > "$NGINX_CONFIG_FILE"
else
  envsubst '${PORT}:${PUBLIC_PATH}:${PUBLIC_PATH_REDIRECT}' \
    < "$TEMPLATE_DIR/default.conf.template" \
    > "$NGINX_CONFIG_FILE"
fi

APP_CONFIG_PATH="$APP_ROOT/app-config.js"
GOOGLE_CONFIG_PATH="$APP_ROOT/google.js"

if [ -n "${APP_CONFIG:-}" ]; then
  printf '%s\n' "$APP_CONFIG" > "$APP_CONFIG_PATH"
  echo "Using custom APP_CONFIG environment variable"
else
  echo "Not using custom APP_CONFIG"
fi

if [ -n "${CLIENT_ID:-}" ] || [ -n "${HEALTHCARE_API_ENDPOINT:-}" ]; then
  if [ -n "${CLIENT_ID:-}" ]; then
    echo "Google Cloud Healthcare \$CLIENT_ID has been provided:"
    echo "$CLIENT_ID"
    echo "Updating config..."
    sed -i -e "s/YOURCLIENTID.apps.googleusercontent.com/$CLIENT_ID/g" "$GOOGLE_CONFIG_PATH"
  fi

  if [ -n "${HEALTHCARE_API_ENDPOINT:-}" ]; then
    echo "Google Cloud Healthcare \$HEALTHCARE_API_ENDPOINT has been provided:"
    echo "$HEALTHCARE_API_ENDPOINT"
    echo "Updating config..."
    sed -i -e "s+https://healthcare.googleapis.com/v1+$HEALTHCARE_API_ENDPOINT+g" \
      "$GOOGLE_CONFIG_PATH"
  fi

  cp "$GOOGLE_CONFIG_PATH" "$APP_CONFIG_PATH"
fi

if [ -f "$APP_CONFIG_PATH" ]; then
  if [ -s "$APP_CONFIG_PATH" ]; then
    echo "Detected non-empty app-config.js. Ensuring .gz file is updated..."
    gzip -c "$APP_CONFIG_PATH" > "$APP_CONFIG_PATH.gz"
    echo "Compressed app-config.js to app-config.js.gz"
  else
    echo "app-config.js is empty. Skipping compression."
  fi
else
  echo "No app-config.js file found. Skipping compression."
fi

echo "Starting Nginx to serve the OHIF Viewer on ${PUBLIC_PATH}"

exec "$@"
