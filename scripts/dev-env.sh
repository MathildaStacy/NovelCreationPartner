# Source from the project root: source scripts/dev-env.sh
# This adjusts only the current shell; it does not replace your global runtimes.
if [ -n "${ZSH_VERSION:-}" ]; then
  _novel_script="${(%):-%x}"
else
  _novel_script="${BASH_SOURCE[0]}"
fi
_novel_root="$(cd "$(dirname "$_novel_script")/.." && pwd)"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if ! command -v nvm >/dev/null 2>&1; then
  for _novel_nvm in "$NVM_DIR/nvm.sh" /opt/homebrew/opt/nvm/nvm.sh /usr/local/opt/nvm/nvm.sh; do
    if [ -s "$_novel_nvm" ]; then
      . "$_novel_nvm"
      break
    fi
  done
fi
if command -v nvm >/dev/null 2>&1; then
  nvm use "$(cat "$_novel_root/.nvmrc")"
fi

if [ -d "$HOME/.local/share/novelcreationpartner/jdk-17/Contents/Home" ]; then
  export JAVA_HOME="$HOME/.local/share/novelcreationpartner/jdk-17/Contents/Home"
elif [ -x /usr/libexec/java_home ]; then
  _novel_java="$(/usr/libexec/java_home -v 17 2>/dev/null)"
  if [ -n "$_novel_java" ]; then export JAVA_HOME="$_novel_java"; fi
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

for _novel_ruby in "$HOME/.local/share/novelcreationpartner/portable-ruby" /opt/homebrew/opt/ruby@3.4 /usr/local/opt/ruby@3.4; do
  if [ -x "$_novel_ruby/bin/ruby" ]; then
    export PATH="$_novel_ruby/bin:$_novel_ruby/lib/ruby/gems/3.4.0/bin:$PATH"
    break
  fi
done
unset _novel_script _novel_root _novel_nvm _novel_java _novel_ruby
