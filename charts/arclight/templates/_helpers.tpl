{{- define "arclight.labels" -}}
app.kubernetes.io/name: arclight-operator
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
