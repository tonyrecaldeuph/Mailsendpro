# Graph Report - .  (2026-08-07)

## Corpus Check
- Corpus is ~15,494 words - fits in a single context window. You may not need a graph.

## Summary
- 148 nodes · 168 edges · 32 communities (14 shown, 18 thin omitted)
- Extraction: 80% EXTRACTED · 20% INFERRED · 1% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.83)
- Token cost: 308,646 input · 0 output

## Community Hubs (Navigation)
- Popup UI Elements & State
- Extension Manifest Config
- Backend Setup & Auth
- Recipient Import & Parsing
- Campaign Control Flow
- Email Sending Worker
- Browser Install Guide
- Manifest Icon Config
- Image Attachment Handling
- Message Template Variables
- File Import UI
- Attachment Upload Handlers
- Email Subject Field
- Cancel Control
- Pause Control
- Resume Control
- Reset Control
- Copy Failed Emails
- Start Campaign Button
- Sender Name Field
- Manual Recipients Field
- View Errors Toggle
- AnomalyDevs Brand Logo
- Extension Icon 128px
- Extension Icon 128px (Original)
- Extension Icon 16px
- Extension Icon 16px (Original)
- Extension Icon 48px
- Extension Icon 48px (Original)
- UPHONE Brand Logo

## God Nodes (most connected - your core abstractions)
1. `setUIState()` - 7 edges
2. `Enlace Mágico (URL de la Aplicación Web)` - 7 edges
3. `updateImportList()` - 6 edges
4. `Carpeta de la extensión (email-sender-extension)` - 6 edges
5. `Mailer Pro — Instrucciones Completas (Guía)` - 5 edges
6. `Code.gs / Código.gs (script de backend)` - 5 edges
7. `doPost(e) — manejador de envío de correo` - 5 edges
8. `sendEmails()` - 4 edges
9. `default_icon` - 4 edges
10. `icons` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Destinatarios escritos manualmente` --references--> `manualList`  [INFERRED]
  INSTRUCCIONES.md → popup.js
- `Importar Excel (.xlsx)` --references--> `fileImport`  [INFERRED]
  INSTRUCCIONES.md → popup.js
- `Importar archivo .txt` --references--> `fileImport`  [INFERRED]
  INSTRUCCIONES.md → popup.js
- `Iniciar Campaña` --references--> `sendBtn`  [INFERRED]
  INSTRUCCIONES.md → popup.js
- `Control: Pausar` --references--> `pauseBtn`  [INFERRED]
  INSTRUCCIONES.md → popup.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Instalación de extensión sin empaquetar en múltiples navegadores** — instrucciones_chrome, instrucciones_brave, instrucciones_edge, instrucciones_opera, instrucciones_firefox, instrucciones_extension_carpeta [INFERRED 0.85]
- **Flujo de control de campaña (pausar/reanudar/cancelar/reiniciar)** — instrucciones_control_pausar, instrucciones_control_reanudar, instrucciones_control_cancelar, instrucciones_control_reiniciar, popup_pausebtn, popup_resumebtn, popup_cancelbtn, popup_resetbtn [INFERRED 0.95]
- **Flujo de ingesta de destinatarios (manual, Excel, TXT)** — instrucciones_recipientes_manual, instrucciones_importar_excel, instrucciones_importar_txt, popup_manuallist, popup_fileimport [INFERRED 0.85]

## Communities (32 total, 18 thin omitted)

### Community 0 - "Popup UI Elements & State"
Cohesion: 0.08
Nodes (21): apiKeyInput, apiTokenInput, attachmentList, attachmentsInput, clearListButton, controlButtons, currentFailedEmails, errorsContainer (+13 more)

### Community 1 - "Extension Manifest Config"
Cohesion: 0.09
Nodes (21): background, service_worker, type, browser_specific_settings, gecko, description, id, strict_min_version (+13 more)

### Community 2 - "Backend Setup & Auth"
Cohesion: 0.15
Nodes (18): Cambiar de Cuenta Gmail, Code.gs / Código.gs (script de backend), doGet(e) — manejador de verificación de estado, doPost(e) — manejador de envío de correo, Enlace Mágico (URL de la Aplicación Web), Error: Status 403 (URL de script expirada), Problema: La extensión no envía nada, GmailApp.sendEmail (API de Apps Script) (+10 more)

### Community 3 - "Recipient Import & Parsing"
Cohesion: 0.24
Nodes (10): clearListHandler(), handleFileImport(), parseExcel(), parseManualLines(), parseTxt(), readFileAsArrayBuffer(), saveState(), updateImportList() (+2 more)

### Community 4 - "Campaign Control Flow"
Cohesion: 0.25
Nodes (9): cancelCampaign(), pauseCampaign(), renderErrors(), resetCampaign(), restoreState(), resumeCampaign(), setProgress(), setUIState() (+1 more)

### Community 5 - "Email Sending Worker"
Cohesion: 0.53
Nodes (5): broadcastCompletion(), broadcastProgress(), currentProgress, sendEmails(), sleep()

### Community 6 - "Browser Install Guide"
Cohesion: 0.33
Nodes (6): Brave (instalación), Google Chrome (instalación), Microsoft Edge (instalación), Carpeta de la extensión (email-sender-extension), Firefox (instalación temporal), Opera / Opera GX (instalación)

### Community 7 - "Manifest Icon Config"
Cohesion: 0.33
Nodes (6): action, default_icon, default_popup, 128, 16, 48

### Community 8 - "Image Attachment Handling"
Cohesion: 0.50
Nodes (4): Adjuntar Imagen (JPG/PNG), Problema: La imagen no se ve en el correo, Embebido de imágenes en línea vía cid (inlineImages), attachments

### Community 9 - "Message Template Variables"
Cohesion: 0.83
Nodes (4): Mensaje HTML del correo, Variable {email}, Variable {nombre}, Textarea: Mensaje HTML con variables (message)

### Community 11 - "File Import UI"
Cohesion: 0.67
Nodes (3): Importar Excel (.xlsx), Importar archivo .txt, fileImport

### Community 12 - "Attachment Upload Handlers"
Cohesion: 0.67
Nodes (3): handleAttachments(), readFileAsDataURL(), updateAttachmentList()

## Ambiguous Edges - Review These
- `doPost(e) — manejador de envío de correo` → `Input: Token de Seguridad (apiToken / SHARED_TOKEN)`  [AMBIGUOUS]
  INSTRUCCIONES.md · relation: shares_data_with

## Knowledge Gaps
- **73 isolated node(s):** `currentProgress`, `manifest_version`, `name`, `description`, `version` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `doPost(e) — manejador de envío de correo` and `Input: Token de Seguridad (apiToken / SHARED_TOKEN)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `delaySeconds` connect `Backend Setup & Auth` to `Popup UI Elements & State`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Enlace Mágico (URL de la Aplicación Web)` (e.g. with `doPost(e) — manejador de envío de correo` and `Input: URL de Aplicación Web (apiKey)`) actually correct?**
  _`Enlace Mágico (URL de la Aplicación Web)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `currentProgress`, `manifest_version`, `name` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Popup UI Elements & State` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Should `Extension Manifest Config` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._