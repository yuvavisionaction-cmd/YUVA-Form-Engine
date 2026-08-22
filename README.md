# YUVA Bharat Forms Engine (`forms-engine`)

A high-performance, lightweight, standalone Dynamic Form Builder & Registration Engine built with **Pure HTML5**, **Modern CSS3 Glassmorphism**, **Vanilla JavaScript (ES6+)**, **Supabase Backend**, and **Google Apps Script Automation**.

This module is completely decoupled from the main website and ready for independent deployment to the subdomain **`forms.yuva.ind.in`**.

---

## 📁 Project Architecture

```
forms-engine/
├── index.html        # Public Participant Form Renderer UI
├── admin.html        # Form Builder Studio, Event Mapper & Submissions Explorer
├── style.css         # Cyber-Dark Glassmorphism Design System & Floating Labels
├── app.js            # Modular Core JS (Supabase Client, Form Engine, Validation, GAS Webhook)
├── config.js         # Centralized Environment Config & Subdomain URL Resolvers
├── schema.sql        # Supabase SQL for forms & form_submissions tables (Only 2 new tables)
├── Code.gs           # Google Apps Script Web App for Event-Tailored Confirmation Emails
└── README.md         # Deployment & Integration Documentation
```

---

## 💡 System Design & Database Integration Flow

```
+-----------------------------------------------------------------------------------+
|                            EXISTING DATABASE (SUPABASE)                           |
|                                                                                   |
|  +------------------------+                     +-------------------------------+  |
|  | events                 | <------------------ | event_publications            |  |
|  | id, title, start_at... |                     | event_id, registration_url... |  |
|  +------------------------+                     +-------------------------------+  |
|              ^                                                  ^                 |
|              | Read Events                                      | Auto-updates    |
|              | for Dropdown                                     | Registration    |
|              |                                                  | Link            |
+--------------|--------------------------------------------------|-----------------+
               |                                                  |
               v                                                  |
+-----------------------------------------------------------------|-----------------+
|                        FORMS ENGINE (forms.yuva.ind.in)         |                 |
|                                                                 |                 |
|  [ admin.html ] ---- (Saves JSON schema) ----> [ public.forms ]-+                 |
|                                                      |                            |
|                                                      | Loads schema               |
|                                                      v                            |
|  [ index.html ] ---- (Submits responses) ----> [ public.form_submissions ]        |
|        |                                             |                            |
|        +-- (Uploads attachments to existing) --------+                            |
|        |   [ event-banners ] storage bucket          | Async Webhook              |
|        |                                             v                            |
|        +-------------------------------------> [ Google Apps Script (Code.gs) ]   |
|                                                      |                            |
|                                                      +--> Event-Tailored Email    |
|                                                           Confirmation to User    |
+-----------------------------------------------------------------------------------+
```

---

## 🚀 Key Features

### 1. Zero Redundant Tables (Connects to Existing Events & Storage)
- **Uses Existing Events:** Directly queries your production `events` and `event_publications` tables.
- **Uses Existing Storage Bucket:** Uploads file attachments into your existing `event-banners` storage bucket under the `form-attachments/` path.
- **Only 2 New Tables Created:**
  1. `forms`: Stores the custom form layout and validation rules as structured JSON.
  2. `form_submissions`: Stores participant entries and metadata.

### 2. Automated Event Link Synchronization
- In `admin.html`, the admin picks an existing event from the dropdown to link.
- When the form is published, its live public URL (`https://forms.yuva.ind.in/?form_id=XYZ`) is generated.
- The engine automatically updates the `registration_url` column in `event_publications` (and `registration_link` in `events`), so all "Register" buttons across the main website instantly route to the live form.

### 3. Advanced Form Builder Studio (`admin.html`)
- **Input Arsenal:** Short Text, Paragraph, Number, Dropdown Select, Radio Groups, Checkboxes, File Attachments (size & MIME restrictions), Date Picker, and Section Dividers.
- **Custom Regex Rules:** Add custom regular expressions and error messages (e.g., `^[6-9]\d{9}$` for 10-digit Indian phone numbers).
- **Visual Canvas Reordering:** Move up/down, duplicate fields, edit options on the fly, and delete.
- **Real-Time Device Simulator:** Interactive preview frame supporting Desktop, Tablet, and Mobile views.
- **Submissions Explorer:** Real-time table view of participant responses with **CSV Export**.

### 4. Participant Form Renderer (`index.html`)
- Loads dynamic schemas by parsing URL query parameters (`?form_id=XYZ` or `?event_id=XYZ`).
- Floating label inputs with real-time validation and instant regex tooltips.
- Drag & Drop file attachment uploader.
- Clean submission confirmation screen with reference ID and printable receipt.

### 5. Event-Tailored Confirmation Email Automation (`Code.gs`)
- Sends branded, rich HTML confirmation emails to the participant.
- The email is customized based on the event (Event Title, Date, Location, Custom Confirmation Message, and Submitted Responses).
- No unnecessary Google Sheets or admin alert emails — 100% focused on direct user confirmation.

---

## 🛠️ Setup Guide

### Step 1: Run `schema.sql` in Supabase
Run [`schema.sql`](file:///d:/Programing/Programming/YUVA%20Bharat/forms-engine/schema.sql) in your Supabase SQL Editor. It creates only `forms` and `form_submissions` tables with RLS policies.

### Step 2: Deploy Google Apps Script Webhook (for User Email Confirmation)
1. Open Google Apps Script ([script.google.com](https://script.google.com)).
2. Paste [`Code.gs`](file:///d:/Programing/Programming/YUVA%20Bharat/forms-engine/Code.gs).
3. Click **Deploy** -> **New Deployment** -> Select **Web App**.
4. Set **Execute as:** `Me` and **Who has access:** `Anyone`.
5. Copy the Web App URL and paste it into `config.js` or via the **Config** modal in `admin.html`.

### Step 3: Deploy to Subdomain (`forms.yuva.ind.in`)
Point your subdomain `forms.yuva.ind.in` (via Netlify/Vercel/Cloudflare Pages) to the `forms-engine` directory as the root.
