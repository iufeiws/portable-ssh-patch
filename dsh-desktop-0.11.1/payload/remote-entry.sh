#!/bin/sh
# Print the current DSH web endpoint line for THIS host (token included).
line=""
f="$HOME/.dsh/dsh-web-$(hostname).log"
if [ -f "$f" ]; then
  line=$(grep -ho "dsh web: http://127.0.0.1:[0-9][0-9]*/?token=[A-Za-z0-9_-]*" "$f" 2>/dev/null | tail -1)
fi
if [ -z "$line" ]; then
  id=$(systemctl --user show -P InvocationID dsh.service 2>/dev/null)
  if [ -n "$id" ]; then
    line=$(journalctl --user "_SYSTEMD_INVOCATION_ID=$id" --no-pager -o cat 2>/dev/null | grep -ho "dsh web: http://127.0.0.1:[0-9][0-9]*/?token=[A-Za-z0-9_-]*" | tail -1)
  fi
fi
printf '%s\n' "$line"
