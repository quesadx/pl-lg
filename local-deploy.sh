#!/bin/sh
# local-deploy.sh — build placitum and install a launcher into ~/.local/bin.
#
# Fresh install: writes the launcher and exits. Existing install: compares the
# version from this checkout against the installed launcher and asks before
# update / downgrade / reinstall.
#
# ponytail: "install" is a launcher that execs this repo's dist/cli/bin.js —
# the repo stays the source of truth (no tarball, no copied node_modules).

set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="$HOME/.local/bin"
EXE="$BIN/placitum"

die() { printf 'local-deploy: %s\n' "$1" >&2; exit 1; }
skip() { printf 'Nothing changed.\n'; exit 0; }

command -v node >/dev/null 2>&1 || die "node is required (try: nix develop)"
command -v npm >/dev/null 2>&1 || die "npm is required (try: nix develop)"
[ -f "$REPO/package.json" ] || die "package.json not found next to this script ($REPO)"

printf 'Building %s...\n' "$REPO"
[ -d "$REPO/node_modules" ] || npm --prefix "$REPO" install --silent
npm --prefix "$REPO" run build --silent

NEW=$(node -e 'console.log(require(process.argv[1]).version)' "$REPO/package.json")

# Prints newer|older|equal; numeric per segment (string compare lies on 1.10 vs 1.9).
compare_versions() {
    node -e '
        const parse = (v) => v.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
        const [a, b] = process.argv.slice(1).map(parse);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            const d = (a[i] || 0) - (b[i] || 0);
            if (d !== 0) { console.log(d > 0 ? "newer" : "older"); process.exit(0); }
        }
        console.log("equal");
    ' "$1" "$2"
}

ask() { # ask <prompt> <default y|n>
    printf '%s ' "$1"
    read -r answer || answer=""
    [ -n "$answer" ] || answer=$2
    case "$answer" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

if [ ! -e "$EXE" ]; then
    action="Installing placitum $NEW (fresh)"
else
    CUR=$("$EXE" --version 2>/dev/null | tr -d '[:space:]') || true
    case "$CUR" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *)
        ask "$EXE exists and is not a placitum CLI; overwrite it? [y/N]" n || skip
        CUR=""
        action="Installing placitum $NEW (overwriting unknown $EXE)"
        ;;
    esac
    if [ -n "$CUR" ]; then
        case "$(compare_versions "$NEW" "$CUR")" in
        newer) ask "placitum $CUR is installed; update to $NEW? [Y/n]" y || skip
            action="Updating placitum $CUR -> $NEW" ;;
        older) ask "placitum $CUR is installed; downgrade to $NEW? [y/N]" n || skip
            action="Downgrading placitum $CUR -> $NEW" ;;
        equal) ask "placitum $CUR already installed; reinstall? [y/N]" n || skip
            action="Reinstalling placitum $NEW" ;;
        esac
    fi
fi
printf '%s\n' "$action"

mkdir -p "$BIN"
tmp="$BIN/.placitum.$$"
cat >"$tmp" <<EOF
#!/bin/sh
# placitum launcher written by $REPO/local-deploy.sh
REPO="$REPO"
if command -v node >/dev/null 2>&1; then
    exec node "\$REPO/dist/cli/bin.js" "\$@"
fi
exec nix develop "\$REPO" --command node "\$REPO/dist/cli/bin.js" "\$@"
EOF
chmod +x "$tmp"
mv "$tmp" "$EXE"

GOT=$("$EXE" --version 2>/dev/null | tr -d '[:space:]') || true
[ "$GOT" = "$NEW" ] || die "verification failed: $EXE reports '${GOT:-nothing}', expected $NEW"
printf 'Installed placitum %s -> %s\n' "$NEW" "$EXE"

case ":$PATH:" in
*":$BIN:"*) ;;
*) printf 'note: %s is not on PATH\n' "$BIN" ;;
esac
