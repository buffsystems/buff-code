#!/bin/sh
# POSIX twin of shell.ps1 for hosts without PowerShell: the same commands and markers.
# `tr` drops the fixture's CRs so the PTY emits the same bytes as WriteLine does.
fixture=$1
printf 'TERMINAL_FIXTURE_READY\n'
while IFS= read -r command; do
  case $command in
    exit) exit 0 ;;
    run)
      tr -d '\r' < "$fixture"
      printf '\nTERMINAL_WORKLOAD_DONE\n'
      ;;
    ping) printf 'TERMINAL_PROCESS_ALIVE\n' ;;
  esac
done
