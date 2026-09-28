/**
 * ============================================================================
 * YUVA BHARAT - FORMS ENGINE SERVERLESS BACKEND (Code.gs)
 * Supabase Database Bridge & Event-Tailored Confirmation Email Dispatcher
 * ============================================================================
 * HOW TO DEPLOY:
 * 1. Open Google Apps Script (script.google.com).
 * 2. Paste this entire file into Code.gs.
 * 3. Click 'Deploy' -> 'New Deployment' -> Select 'Web App'.
 * 4. Execute as: 'Me' (your Google account).
 * 5. Who has access: 'Anyone' (required for form submissions & API calls).
 * 6. Copy the Web App URL into forms-engine/config.js.
 * ============================================================================
 */

const CONFIG = {
  ORGANIZATION_NAME: 'YUVA Bharat',
  SUPPORT_EMAIL: 'admin@yuva.ind.in',
  NOREPLY_EMAIL: 'noreply@yuva.ind.in',
  BRAND_SAFFRON: '#FF9933',
  BRAND_NAVY: '#000080',
  BRAND_GREEN: '#138808',
  
  // Supabase REST API Credentials
  SUPABASE_URL: 'https://jgsrsjwmywiirtibofth.supabase.co',
  SUPABASE_KEY: 'sb_publishable_5KtvO0cEHfnECBoyp2CQnw_RC3_x2me',
  
  ENABLE_PARTICIPANT_EMAIL: true
};

/**
 * Handle POST Requests (All Database & Email Operations)
 */
function doPost(e) {
  try {
    let payload = {};
    if (e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        payload = e.parameter || {};
      }
    } else {
      payload = e.parameter || {};
    }

    const action = payload.action || 'submit_form';

    // 1. ACTION: SAVE / PUBLISH FORM DEFINITION
    if (action === 'save_form') {
      const formData = payload.form || payload;
      const result = handleSaveForm(formData);
      return createJsonResponse({
        status: 'success',
        message: 'Form published to database successfully.',
        data: result
      });
    }

    // 2. ACTION: SUBMIT PARTICIPANT RESPONSE & SEND CONFIRMATION EMAIL
    if (action === 'submit_form' || action === 'form_submission') {
      const submissionData = payload.submission || payload;
      const result = handleSubmitForm(submissionData);
      return createJsonResponse({
        status: 'success',
        message: 'Response recorded and confirmation email dispatched.',
        data: result
      });
    }

    // 3. ACTION: PASS / APPROVE FORM (SUPER ADMIN VERIFICATION)
    if (action === 'pass_form' || action === 'approve_form') {
      const formId = payload.form_id || payload.id;
      const eventId = payload.event_id;
      const result = handlePassForm(formId, eventId);
      return createJsonResponse({
        status: 'success',
        message: 'Form verified and passed successfully.',
        data: result
      });
    }

    // 4. ACTION: TOGGLE FORM ACTIVE / CLOSED STATE
    if (action === 'toggle_form_active' || action === 'close_form') {
      const formId = payload.form_id || payload.id;
      const isActive = payload.is_active !== undefined ? payload.is_active : false;
      const result = handleToggleFormActive(formId, isActive);
      return createJsonResponse({
        status: 'success',
        message: `Form status updated to ${isActive ? 'active' : 'closed'}.`,
        data: result
      });
    }

    // 5. ACTION: REVOKE FORM APPROVAL
    if (action === 'revoke_form') {
      const formId = payload.form_id || payload.id;
      const result = handleRevokeForm(formId);
      return createJsonResponse({
        status: 'success',
        message: 'Form verification revoked. Status set to under review.',
        data: result
      });
    }

    // 6. ACTION: DELETE FORM
    if (action === 'delete_form') {
      const formId = payload.form_id || payload.id;
      const result = handleDeleteForm(formId);
      return createJsonResponse({
        status: 'success',
        message: 'Form deleted from database.',
        data: result
      });
    }

    // 7. ACTION: GET ALL FORMS
    if (action === 'get_all_forms') {
      const forms = handleFetchAllForms();
      return createJsonResponse({
        status: 'success',
        data: forms
      });
    }

    // 8. ACTION: GET SUBMISSIONS
    if (action === 'get_submissions') {
      const formId = payload.form_id;
      const subs = handleFetchSubmissions(formId);
      return createJsonResponse({
        status: 'success',
        data: subs
      });
    }

    // 9. ACTION: TEST PING
    if (action === 'test_ping') {
      return createJsonResponse({
        status: 'success',
        message: 'YUVA Forms Serverless Backend is online and operational.',
        timestamp: new Date().toISOString()
      });
    }

    // 10. ACTION: RESEND CONFIRMATION EMAIL ONLY (no DB insert — used by Advanced Admin resend button)
    if (action === 'resend_confirmation') {
      const emailAddr = (payload.participant_email || '').trim();
      if (!emailAddr || !emailAddr.includes('@')) {
        return createJsonResponse({ status: 'error', message: 'Invalid or missing participant_email for resend.' });
      }
      sendEventConfirmationEmail({
        form_id:              payload.form_id || '',
        form_title:           payload.form_title || 'Event Registration',
        event_title:          payload.event_title || payload.form_title || 'YUVA Bharat Event',
        event_date:           payload.event_date || '',
        event_location:       payload.event_location || '',
        confirmation_message: payload.confirmation_message || '',
        submission_id:        payload.submission_id || '------',
        participant_name:     payload.participant_name || 'Participant',
        participant_email:    emailAddr,
        participant_phone:    payload.participant_phone || '',
        responses:            payload.responses || {},
        files:                payload.files || [],
        submitted_at:         payload.submitted_at || new Date().toISOString()
      });
      return createJsonResponse({
        status: 'success',
        message: 'Confirmation email resent to ' + emailAddr
      });
    }

    return createJsonResponse({
      status: 'error',
      message: 'Unknown action parameter: ' + action
    });

  } catch (err) {
    console.error('[Code.gs] Error processing request:', err);
    return createJsonResponse({
      status: 'error',
      message: err.message || 'Internal server error occurred in Google Apps Script.'
    });
  }
}

/**
 * Handle GET Requests (Health Check)
 */
function doGet(e) {
  return createJsonResponse({
    status: 'success',
    message: 'YUVA Forms Engine Serverless API is running.',
    timestamp: new Date().toISOString()
  });
}

// ============================================================================
// DATABASE HANDLERS (SUPABASE REST API VIA URLFETCHAPP)
// ============================================================================

/**
 * Helper: Execute Supabase REST API Request
 */
function supabaseRest(endpoint, method, payload, customHeaders) {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/${endpoint}`;
  
  const headers = {
    'apikey': CONFIG.SUPABASE_KEY,
    'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...(customHeaders || {})
  };

  const options = {
    method: method || 'GET',
    headers: headers,
    muteHttpExceptions: true
  };

  if (payload && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code >= 400) {
    throw new Error(`Supabase API Error (${code}): ${text}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return text;
  }
}

/**
 * Save / Upsert Form Schema to public.forms & sync event publication
 */
function handleSaveForm(form) {
  if (!form || !form.id) {
    throw new Error('Missing required form.id parameter');
  }

  const formPayload = {
    id: form.id,
    event_id: form.event_id ? parseInt(form.event_id, 10) : null,
    title: form.title || 'Untitled Form',
    description: form.description || '',
    category: form.category || 'General',
    creator_name: form.creator_name || null,
    creator_email: form.creator_email || null,
    creator_phone: form.creator_phone || null,
    schema_json: form.schema_json || { fields: [] },
    settings: form.settings || {},
    is_approved: form.is_approved !== undefined ? Boolean(form.is_approved) : false,
    is_active: form.is_active !== undefined ? Boolean(form.is_active) : true,
    updated_at: new Date().toISOString()
  };

  // Ensure mandatory attendee fields (Name, Email, Phone) are always present and required
  if (formPayload.schema_json && Array.isArray(formPayload.schema_json.fields)) {
    const fList = formPayload.schema_json.fields;
    const hasName = fList.some(function(f) { return f.id === 'field_full_name' || (f.type === 'text' && (f.label || '').toLowerCase().indexOf('name') !== -1); });
    const hasEmail = fList.some(function(f) { return f.type === 'email' || f.id === 'field_email'; });
    const hasPhone = fList.some(function(f) { return f.type === 'phone' || f.id === 'field_phone'; });

    if (!hasName) fList.unshift({ id: 'field_full_name', type: 'text', label: 'Full Name', required: true });
    if (!hasEmail) fList.splice(1, 0, { id: 'field_email', type: 'email', label: 'Email Address', required: true });
    if (!hasPhone) fList.splice(2, 0, { id: 'field_phone', type: 'phone', label: 'WhatsApp Mobile Number', required: true });

    fList.forEach(function(f) {
      if (f.id === 'field_full_name' || f.id === 'field_email' || f.id === 'field_phone' || f.type === 'email' || f.type === 'phone') {
        f.required = true;
      }
    });
  }

  // Upsert to forms table (resolution=merge-duplicates)
  const result = supabaseRest('forms', 'POST', formPayload, {
    'Prefer': 'resolution=merge-duplicates,return=representation'
  });

  // If linked to an event, sync registration_url ONLY IF form is approved & active
  if (formPayload.event_id && formPayload.is_approved && formPayload.is_active) {
    try {
      const publicUrl = `https://forms.yuva.ind.in/?form_id=${formPayload.id}`;
      
      // Update events table (both registration_url and registration_link)
      try {
        supabaseRest(`events?id=eq.${formPayload.event_id}`, 'PATCH', {
          registration_url: publicUrl,
          registration_link: publicUrl
        });
      } catch (e1) {
        try { supabaseRest(`events?id=eq.${formPayload.event_id}`, 'PATCH', { registration_url: publicUrl }); } catch (e1a) {}
        try { supabaseRest(`events?id=eq.${formPayload.event_id}`, 'PATCH', { registration_link: publicUrl }); } catch (e1b) {}
      }

      // Update event_publications table
      supabaseRest(`event_publications?event_id=eq.${formPayload.event_id}`, 'PATCH', {
        registration_url: publicUrl
      });
    } catch (syncErr) {
      console.warn('[Code.gs] Could not sync event registration URL:', syncErr);
    }
  }

  return (Array.isArray(result) && result.length > 0) ? result[0] : result;
}

/**
 * Super Admin: Pass / Verify Form & Sync Live Event Link
 */
function handlePassForm(formId, eventId) {
  if (!formId) throw new Error('Missing formId');

  const updatePayload = {
    is_approved: true,
    is_active: true,
    approved_at: new Date().toISOString(),
    approved_by: 'Super Admin',
    updated_at: new Date().toISOString()
  };

  const result = supabaseRest(`forms?id=eq.${encodeURIComponent(formId)}`, 'PATCH', updatePayload);

  if (eventId) {
    try {
      const publicUrl = `https://forms.yuva.ind.in/?form_id=${formId}`;
      try {
        supabaseRest(`events?id=eq.${eventId}`, 'PATCH', { 
          registration_url: publicUrl,
          registration_link: publicUrl 
        });
      } catch (e1) {
        try { supabaseRest(`events?id=eq.${eventId}`, 'PATCH', { registration_url: publicUrl }); } catch (e1a) {}
        try { supabaseRest(`events?id=eq.${eventId}`, 'PATCH', { registration_link: publicUrl }); } catch (e1b) {}
      }
      supabaseRest(`event_publications?event_id=eq.${eventId}`, 'PATCH', { registration_url: publicUrl });
    } catch (e) {
      console.warn('[Code.gs] Link sync warning:', e);
    }
  }

  return result;
}

/**
 * Super Admin: Toggle Form Active / Closed State
 */
function handleToggleFormActive(formId, isActive) {
  if (!formId) throw new Error('Missing formId');

  const updatePayload = {
    is_active: Boolean(isActive),
    updated_at: new Date().toISOString()
  };

  return supabaseRest(`forms?id=eq.${encodeURIComponent(formId)}`, 'PATCH', updatePayload);
}

/**
 * Super Admin: Revoke Verification (Put Under Review & Unlink Event Registration)
 */
function handleRevokeForm(formId) {
  if (!formId) throw new Error('Missing formId');

  const updatePayload = {
    is_approved: false,
    updated_at: new Date().toISOString()
  };

  const result = supabaseRest(`forms?id=eq.${encodeURIComponent(formId)}`, 'PATCH', updatePayload);

  // Unlink registration link from linked event if any
  try {
    const formObj = supabaseRest(`forms?id=eq.${encodeURIComponent(formId)}&select=event_id`, 'GET');
    if (Array.isArray(formObj) && formObj.length > 0 && formObj[0].event_id) {
      const eventId = formObj[0].event_id;
      try {
        supabaseRest(`events?id=eq.${eventId}`, 'PATCH', { registration_url: null, registration_link: null });
      } catch (e1) {}
      try {
        supabaseRest(`event_publications?event_id=eq.${eventId}`, 'PATCH', { registration_url: null });
      } catch (e2) {}
    }
  } catch (e) {
    console.warn('[Code.gs] Revoke link cleanup warning:', e);
  }

  return result;
}

/**
 * Record Participant Submission & Send Email Confirmation
 */
function handleSubmitForm(submission) {
  if (!submission || !submission.form_id) {
    throw new Error('Missing required submission.form_id parameter');
  }

  const submissionPayload = {
    form_id: submission.form_id,
    event_id: submission.event_id ? parseInt(submission.event_id, 10) : null,
    participant_name: submission.participant_name || 'Participant',
    participant_email: submission.participant_email || '',
    participant_phone: submission.participant_phone || '',
    responses_json: submission.responses_json || submission.responses || {},
    files_json: submission.files_json || submission.files || [],
    metadata_json: submission.metadata_json || {},
    status: 'submitted',
    created_at: new Date().toISOString()
  };

  const emailAddr = (submissionPayload.participant_email || '').trim();

  // ── DUPLICATE GUARD ──────────────────────────────────────────────────────
  // Prevent same email registering twice for the same form.
  // If a record already exists, return existing reference without sending duplicate emails.
  if (emailAddr && emailAddr.includes('@')) {
    try {
      const existing = supabaseRest(
        `form_submissions?form_id=eq.${encodeURIComponent(submission.form_id)}&participant_email=eq.${encodeURIComponent(emailAddr)}&select=id,created_at&limit=1`,
        'GET'
      );
      if (Array.isArray(existing) && existing.length > 0) {
        const existingRecord = existing[0];
        const existingRef = existingRecord.id.substring(0, 8).toUpperCase();
        console.log(`[Code.gs] DUPLICATE detected for ${emailAddr} on form ${submission.form_id} — existing ref: ${existingRef}. No duplicate email triggered.`);

        return {
          submission_id: existingRef,
          record: existingRecord,
          duplicate: true,
          message: 'Already registered with this email address. Existing reference preserved.'
        };
      }
    } catch (dupCheckErr) {
      // Non-fatal — if duplicate check fails, proceed with normal insert
      console.warn('[Code.gs] Duplicate check failed, proceeding with insert:', dupCheckErr.toString());
    }
  }
  // ── END DUPLICATE GUARD ──────────────────────────────────────────────────

  // Insert to form_submissions table
  const inserted = supabaseRest('form_submissions', 'POST', submissionPayload, {
    'Prefer': 'return=representation'
  });

  const record = (Array.isArray(inserted) && inserted.length > 0) ? inserted[0] : (inserted || {});
  const refCode = (record.id ? record.id.substring(0, 8) : Math.random().toString(36).substring(2, 10)).toUpperCase();

  // Send Event-Tailored Confirmation Email
  console.log(`[Code.gs] participant_email resolved: "${emailAddr}"`);

  if (CONFIG.ENABLE_PARTICIPANT_EMAIL && emailAddr && emailAddr.includes('@')) {
    try {
      sendEventConfirmationEmail({
        form_id: submission.form_id,
        form_title: submission.form_title || 'Registration Form',
        event_title: submission.event_title || submission.form_title || 'Event Registration',
        event_date: submission.event_date || '',
        event_location: submission.event_location || '',
        confirmation_message: submission.confirmation_message || '',
        submission_id: refCode,
        participant_name: submissionPayload.participant_name,
        participant_email: emailAddr,
        participant_phone: submissionPayload.participant_phone,
        responses: submissionPayload.responses_json,
        files: submissionPayload.files_json,
        submitted_at: submissionPayload.created_at
      });
      console.log(`[Code.gs] Email dispatch succeeded for ${emailAddr}`);
    } catch (emailErr) {
      console.error('[Code.gs] Email dispatch FAILED:', emailErr.toString());
    }
  } else {
    console.warn(`[Code.gs] Email skipped — invalid or missing address: "${emailAddr}"`);
  }

  return {
    submission_id: refCode,
    record: record
  };
}

/**
 * Delete Form from public.forms
 */
function handleDeleteForm(formId) {
  if (!formId) throw new Error('Missing form_id');
  return supabaseRest(`forms?id=eq.${formId}`, 'DELETE');
}

/**
 * Fetch All Forms from public.forms
 */
function handleFetchAllForms() {
  return supabaseRest('forms?select=*,events(id,title,status,location)&order=updated_at.desc', 'GET') || [];
}

/**
 * Fetch Submissions from public.form_submissions
 */
function handleFetchSubmissions(formId) {
  let endpoint = 'form_submissions?select=*&order=created_at.desc';
  if (formId) {
    endpoint += `&form_id=eq.${formId}`;
  }
  return supabaseRest(endpoint, 'GET') || [];
}

// ============================================================================
// EMAIL DISPATCHER (EVENT-TAILORED CONFIRMATION EMAIL)
// ============================================================================

/**
 * Dispatches an event-tailored confirmation email to the user
 */
function sendEventConfirmationEmail(data) {
  const recipientEmail = data.participant_email;
  if (!recipientEmail || !recipientEmail.includes('@')) {
    console.warn('[Code.gs] Invalid or missing participant email:', recipientEmail);
    return { sent: false, reason: 'Invalid email' };
  }

  const participantName = data.participant_name || 'Participant';
  const eventTitle = data.event_title || data.form_title || 'YUVA Bharat Event';
  const eventDate = data.event_date || 'Announced via email';
  const eventLocation = data.event_location || 'Official Venue / Online';
  const submissionId = data.submission_id || 'YV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const customMessage = data.confirmation_message || 'Thank you for registering. Your application has been successfully recorded in our central portal.';
  
  // Format user responses into clean HTML table rows
  let responsesHtml = '';
  if (data.responses && typeof data.responses === 'object') {
    for (const [key, value] of Object.entries(data.responses)) {
      if (value !== undefined && value !== null && value !== '') {
        const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
        responsesHtml += `
          <tr>
            <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px; font-weight: 600; width: 38%;">${escapeHtmlForEmail(key)}</td>
            <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 13px;">${escapeHtmlForEmail(valStr)}</td>
          </tr>
        `;
      }
    }
  }

  const emailSubject = `Registration Confirmed: ${eventTitle} [Ref: ${submissionId}]`;

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden;">
        
        <!-- Saffron Brand Header -->
        <div style="background: linear-gradient(135deg, ${CONFIG.BRAND_SAFFRON} 0%, #e67300 100%); padding: 24px 28px; color: #ffffff;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em;">YUVA Bharat</h1>
          <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em;">Youth Vision Action • Unified Forms</p>
        </div>

        <!-- Body Content -->
        <div style="padding: 28px;">
          <div style="display: inline-block; padding: 4px 10px; background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 9999px; color: ${CONFIG.BRAND_GREEN}; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px;">
            Registration Confirmed
          </div>

          <h2 style="margin: 0 0 10px 0; font-size: 18px; color: ${CONFIG.BRAND_NAVY};">Namaste, ${escapeHtmlForEmail(participantName)}!</h2>
          <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.5; color: #334155;">${escapeHtmlForEmail(customMessage)}</p>

          <!-- Reference Number Card -->
          <div style="background-color: #f0fdf4; border: 1px dashed #22c55e; border-radius: 8px; padding: 14px; text-align: center; margin-bottom: 22px;">
            <div style="font-size: 11px; font-weight: 700; color: #16a34a; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Application Reference ID</div>
            <div style="font-family: monospace; font-size: 20px; font-weight: 800; color: ${CONFIG.BRAND_GREEN}; letter-spacing: 0.1em;">${submissionId}</div>
          </div>

          <!-- Event Details -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 22px;">
            <h3 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; color: ${CONFIG.BRAND_NAVY};">Event Summary</h3>
            <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: #0f172a;">${escapeHtmlForEmail(eventTitle)}</p>
            ${eventDate ? `<p style="margin: 0 0 4px 0; font-size: 13px; color: #475569;"><strong>Date / Time:</strong> ${escapeHtmlForEmail(eventDate)}</p>` : ''}
            ${eventLocation ? `<p style="margin: 0; font-size: 13px; color: #475569;"><strong>Venue / Mode:</strong> ${escapeHtmlForEmail(eventLocation)}</p>` : ''}
          </div>

          <!-- Responses Summary Table -->
          ${responsesHtml ? `
            <div style="margin-bottom: 22px;">
              <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; color: ${CONFIG.BRAND_NAVY};">Submitted Details</h3>
              <table style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <tbody>
                  ${responsesHtml}
                </tbody>
              </table>
            </div>
          ` : ''}

          <p style="font-size: 12px; color: #64748b; margin: 20px 0 0 0; line-height: 1.5;">
            Please preserve this email and reference ID for entry accreditation or future communication.
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 28px; text-align: center; font-size: 11px; color: #94a3b8;">
          <p style="margin: 0 0 4px 0; font-weight: 600; color: #64748b;">© 2026 YUVA Bharat • Youth Vision Action</p>
          <p style="margin: 0;">Support: <a href="mailto:${CONFIG.SUPPORT_EMAIL}" style="color: ${CONFIG.BRAND_SAFFRON}; text-decoration: none;">${CONFIG.SUPPORT_EMAIL}</a></p>
        </div>

      </div>
    </body>
    </html>
  `;

  const textBody =
    `Namaste ${participantName},\n\n` +
    `Thank you for registering for "${eventTitle}".\n` +
    `Your Application Reference ID is: ${submissionId}\n\n` +
    `Event: ${eventTitle}\n` +
    (eventDate ? `Date / Time: ${eventDate}\n` : '') +
    (eventLocation ? `Venue: ${eventLocation}\n` : '') +
    `\nPlease preserve this email and reference ID for entry accreditation or future communication.\n\n` +
    `YUVA Bharat · Youth Vision Action\n` +
    `Support: contact@yuva.ind.in`;

  GmailApp.sendEmail(recipientEmail, emailSubject, textBody, {
    htmlBody: htmlBody,
    name: 'Event Form Registration',
    replyTo: 'noreply@yuva.ind.in'
  });

  console.log(`[Code.gs] Confirmation email sent to ${recipientEmail} for ${eventTitle} | Ref: ${submissionId}`);
  return { sent: true, recipient: recipientEmail };
}

/**
 * Escape HTML special characters for email safety
 */
function escapeHtmlForEmail(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Creates a CORS-friendly JSON TextOutput response
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// ▶ AUTHORIZATION BOOTSTRAPPER
//   Run once after every new deployment to pre-authorize all OAuth scopes.
//   Select "initializeAuthorization" → click ▶ Run → accept the popup.
// ============================================================================

/**
 * Run this function ONCE after every new deployment.
 *
 * It silently touches every Google service used by this script
 * so the OAuth permission dialog fires immediately, preventing
 * silent email failures in production.
 *
 * NO emails are sent. NO data is modified.
 *
 * Services authorized:
 *   ✅ ScriptApp    — script identity & token
 *   ✅ Session      — effective user account
 *   ✅ GmailApp     — send confirmation emails
 *   ✅ MailApp      — fallback email sender & quota
 *   ✅ UrlFetchApp  — Supabase REST API calls
 */
function initializeAuthorization() {
  const results = [];

  // ScriptApp — script identity
  try {
    ScriptApp.getOAuthToken();
    results.push('✅ ScriptApp   — OAuth token issued');
  } catch (e) { results.push('❌ ScriptApp   — ' + e.message); }

  // Session — identify executing account
  try {
    const user = Session.getEffectiveUser().getEmail();
    results.push('✅ Session     — executing as: ' + user);
  } catch (e) { results.push('❌ Session     — ' + e.message); }

  // GmailApp — compose/send scope (getDrafts is a read-only auth trigger)
  try {
    GmailApp.getDrafts();
    results.push('✅ GmailApp    — send scope authorized');
  } catch (e) { results.push('❌ GmailApp    — ' + e.message); }

  // MailApp — email sending + quota scope
  try {
    const quota = MailApp.getRemainingDailyQuota();
    results.push('✅ MailApp     — authorized (daily quota: ' + quota + ')');
  } catch (e) { results.push('❌ MailApp     — ' + e.message); }

  // UrlFetchApp — external HTTPS requests (Supabase)
  try {
    const res = UrlFetchApp.fetch(CONFIG.SUPABASE_URL + '/rest/v1/', {
      method: 'GET', muteHttpExceptions: true,
      headers: { 'apikey': CONFIG.SUPABASE_KEY }
    });
    results.push('✅ UrlFetchApp — authorized (Supabase HTTP ' + res.getResponseCode() + ')');
  } catch (e) { results.push('❌ UrlFetchApp — ' + e.message); }

  const summary = results.join('\n');
  console.log('\n====== YUVA Forms Engine — Authorization ======\n' + summary + '\n===============================================');
  return summary;
}