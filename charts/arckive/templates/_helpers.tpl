{{- define "arckive.labels" -}}
app.kubernetes.io/name: arckive-operator
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
