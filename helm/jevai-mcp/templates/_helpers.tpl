{{/*
Expand the name of the chart.
*/}}
{{- define "jevai-mcp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "jevai-mcp.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "jevai-mcp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "jevai-mcp.labels" -}}
helm.sh/chart: {{ include "jevai-mcp.chart" . }}
{{ include "jevai-mcp.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "jevai-mcp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "jevai-mcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "jevai-mcp.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "jevai-mcp.fullname" .) }}
{{- end }}
{{- end }}

{{- define "jevai-mcp.imageTag" -}}
{{- default .Chart.AppVersion .Values.image.tag }}
{{- end }}

{{/*
Public hostname agents connect to.
*/}}
{{- define "jevai-mcp.publicHostname" -}}
{{- default (include "jevai-mcp.fullname" .) .Values.integration.publicHostname }}
{{- end }}

{{- define "jevai-mcp.validate" -}}
{{- if not (or .Values.existingSecret .Values.jevaiApiKey) }}
{{- fail "Set jevaiApiKey (the DefAPI key) or existingSecret to an already existing Secret." }}
{{- end }}
{{- $mode := .Values.dashboard.requestStateStorage }}
{{- if not (or (eq $mode "off") (eq $mode "metadata_only") (eq $mode "full")) }}
{{- fail "dashboard.requestStateStorage must be off, metadata_only or full." }}
{{- end }}
{{- if ne (int .Values.replicaCount) 1 }}
{{- fail "replicaCount must be 1: the SQLite database uses a ReadWriteOnce volume." }}
{{- end }}
{{- end }}
