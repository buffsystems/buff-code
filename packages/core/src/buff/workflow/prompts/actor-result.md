

When you are done, call `workflow_result` once with your result as `result`. It must match this JSON schema (field descriptions say what each field means):

```json
{{schema}}
```

If the tool reports mismatches, fix them and call it again. Do not put the result anywhere else.
