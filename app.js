/**
 * ============================================================================
 * YUVA BHARAT - FORMS ENGINE MASTER CORE SCRIPT (app.js)
 * Standalone, Modular Vanilla JavaScript Architecture (ES6+)
 * Supabase DB Integration + Google Apps Script Webhooks + Dynamic Form Builder
 * ============================================================================
 */

(function () {
  'use strict';

  // ===== TOAST & UI NOTIFICATION UTILITIES =====
  const Toast = {
    show(type, title, message, duration = 4500) {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;

      const iconMap = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle',
        warning: 'fas fa-exclamation-triangle'
      };

      toast.innerHTML = `
        <div class="toast-icon"><i class="${iconMap[type] || iconMap.info}"></i></div>
        <div class="toast-content">
          <div class="toast-title">${escapeHtml(title)}</div>
          <div class="toast-msg">${escapeHtml(message)}</div>
        </div>
        <button class="btn-icon btn-secondary" style="padding: 2px 6px; border:none; background:transparent; cursor:pointer;" onclick="this.parentElement.remove()">
          <i class="fas fa-times" style="font-size:12px; color:var(--text-muted)"></i>
        </button>
      `;

      container.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 50);

      if (duration > 0) {
        setTimeout(() => {
          toast.classList.remove('show');
          setTimeout(() => toast.remove(), 300);
        }, duration);
      }

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          if (type === 'success') navigator.vibrate([12, 35, 20]);
          else if (type === 'error') navigator.vibrate([40, 30, 40, 30, 60]);
          else if (type === 'warning') navigator.vibrate([25, 40, 25]);
          else navigator.vibrate(10);
        } catch (_) { }
      }
    },
    success(title, message) { this.show('success', title, message); },
    error(title, message) { this.show('error', title, message); },
    info(title, message) { this.show('info', title, message); },
    warning(title, message) { this.show('warning', title, message); }
  };

  // Helper: Escape HTML
  function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper: Slugify string
  function slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  }

  // Helper: Generate clean, concise, short SaaS Form ID
  function generateFormId(title, eventId) {
    if (eventId) {
      const cleanWords = (title || 'event')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join('-');
      return `${cleanWords || 'event'}-ev${eventId}`;
    }

    if (title && title.trim()) {
      const cleanWords = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .join('-');
      const shortCode = Math.random().toString(36).substring(2, 6);
      return `${cleanWords || 'form'}-${shortCode}`;
    }

    return `frm_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ===== GOOGLE APPS SCRIPT VERIFICATION SERVICE BRIDGE =====
  const GAS_VERIFICATION_URL = 'https://script.google.com/macros/s/AKfycbymRqbH4vOealq3hw3gCSm-y-QAUB0m1ZNM_GpAzJ5F9QBcYfppcF4UIR_ZUBCOuQ56TQ/exec';

  async function callVerificationService(payload) {
    try {
      const response = await fetch(GAS_VERIFICATION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const raw = await response.text();
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`Invalid response from verification service: ${raw}`);
      }
    } catch (error) {
      return callVerificationServiceJsonp(payload);
    }
  }

  function callVerificationServiceJsonp(payload) {
    return new Promise((resolve, reject) => {
      const callbackName = `yuvaFormsVerifyCb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timeoutMs = 15000;

      const cleanup = (scriptEl) => {
        if (scriptEl && scriptEl.parentNode) {
          scriptEl.parentNode.removeChild(scriptEl);
        }
        try {
          delete window[callbackName];
        } catch {
          window[callbackName] = undefined;
        }
      };

      const timer = setTimeout(() => {
        cleanup(script);
        reject(new Error('Verification service timeout'));
      }, timeoutMs);

      window[callbackName] = (result) => {
        clearTimeout(timer);
        cleanup(script);
        resolve(result || { success: false, error: 'Empty response from verification service' });
      };

      const query = new URLSearchParams({
        ...Object.fromEntries(
          Object.entries(payload).map(([k, v]) => [k, v == null ? '' : String(v)])
        ),
        callback: callbackName,
        _ts: String(Date.now())
      });

      const script = document.createElement('script');
      script.src = `${GAS_VERIFICATION_URL}?${query.toString()}`;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        cleanup(script);
        reject(new Error('Verification service request failed'));
      };

      document.body.appendChild(script);
    });
  }

  // ===== SUPABASE CLIENT INITIALIZATION =====
  class SupabaseService {
    constructor() {
      this.client = null;
      this.init();
    }

    init() {
      const creds = window.YUVA_FORMS_CONFIG.getCredentials();
      if (window.supabase && creds.supabaseUrl && creds.supabaseKey) {
        try {
          this.client = window.supabase.createClient(creds.supabaseUrl, creds.supabaseKey);
          console.log('[SupabaseService] Client initialized successfully.');
        } catch (e) {
          console.error('[SupabaseService] Failed to initialize Supabase client:', e);
        }
      } else {
        console.warn('[SupabaseService] Supabase library not available on window or missing credentials.');
      }
    }

    getClient() {
      if (!this.client) this.init();
      return this.client;
    }

    // 1. Fetch all events from Supabase (using published_events view to get category)
    async fetchEvents() {
      const client = this.getClient();
      if (!client) throw new Error('Database client not configured');
      try {
        const { data, error } = await client
          .from('published_events')
          .select('id, title, description, start_at, end_at, location, status, category')
          .order('start_at', { ascending: false });

        if (!error && data) return data;
      } catch (_) {}

      const { data, error } = await client
        .from('events')
        .select('id, title, description, start_at, end_at, location, status')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    }

    // 2. Fetch Form by ID or Event ID
    async fetchForm(formId, eventId) {
      const client = this.getClient();
      if (!client) throw new Error('Database client not configured');

      let query = client.from('forms').select('*, events(id, title, status, start_at, end_at, location)');

      if (formId) {
        query = query.eq('id', formId);
      } else if (eventId) {
        query = query.eq('event_id', eventId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    }

    // 3. Save / Upsert Form Schema
    async saveForm(formData) {
      const isApproved = formData.is_approved !== undefined ? Boolean(formData.is_approved) : false;
      const isActive = formData.is_active !== undefined ? Boolean(formData.is_active) : true;

      const formPayload = {
        id: formData.id,
        event_id: formData.event_id || null,
        title: formData.title,
        description: formData.description || '',
        category: formData.category || 'General',
        creator_name: formData.creator_name || null,
        creator_email: formData.creator_email || null,
        creator_phone: formData.creator_phone || null,
        created_by_uploader: formData.created_by_uploader || null,
        schema_json: formData.schema_json,
        settings: formData.settings || {},
        is_approved: isApproved,
        is_active: isActive,
        updated_at: new Date().toISOString()
      };

      // Strict enforcement: Ensure Name, Email, and Phone exist and are required in schema_json
      if (formPayload.schema_json && Array.isArray(formPayload.schema_json.fields)) {
        const fList = formPayload.schema_json.fields;
        const hasName = fList.some(f => f.id === 'field_full_name' || (f.type === 'text' && (f.label || '').toLowerCase().includes('name')));
        const hasEmail = fList.some(f => f.type === 'email' || f.id === 'field_email');
        const hasPhone = fList.some(f => f.type === 'phone' || f.id === 'field_phone');

        if (!hasName) fList.unshift({ id: 'field_full_name', type: 'text', label: 'Full Name', required: true });
        if (!hasEmail) fList.splice(1, 0, { id: 'field_email', type: 'email', label: 'Email Address', required: true });
        if (!hasPhone) fList.splice(2, 0, { id: 'field_phone', type: 'phone', label: 'WhatsApp Mobile Number', required: true });

        fList.forEach(f => {
          if (f.id === 'field_full_name' || f.id === 'field_email' || f.id === 'field_phone' || f.type === 'email' || f.type === 'phone') {
            f.required = true;
          }
        });
      }

      // 1. Primary: Save through Google Apps Script serverless backend (bypasses RLS policy blocks)
      if (window.YUVA_FORMS_CONFIG.gas && window.YUVA_FORMS_CONFIG.gas.enabled) {
        try {
          console.log('[SupabaseService] Saving form via Google Apps Script bridge...');
          await GASService.sendRequest('save_form', { form: formPayload });
        } catch (gasErr) {
          console.warn('[SupabaseService] GAS bridge save failed, attempting direct Supabase fallback:', gasErr);
        }
      }

      // 2. Direct Supabase client upsert
      const client = this.getClient();
      let data = formPayload;
      if (client) {
        try {
          const { data: dbData, error } = await client
            .from('forms')
            .upsert(formPayload, { onConflict: 'id' })
            .select()
            .single();

          if (dbData) data = dbData;
        } catch (supaErr) {
          console.warn('[SupabaseService] Direct upsert note:', supaErr);
        }
      }

      // Synchronize live registration URL to event ONLY if Super Admin has approved it
      if (formPayload.event_id && formPayload.is_approved && formPayload.is_active) {
        const publicUrl = `${window.YUVA_FORMS_CONFIG.routing.productionBaseUrl}/?form_id=${formPayload.id}`;
        try {
          await this.updateEventRegistrationLink(formPayload.event_id, publicUrl);
          console.log(`[SupabaseService] Synced event ${formPayload.event_id} registration_url to ${publicUrl}`);
        } catch (syncErr) {
          console.warn('[SupabaseService] Automatic link sync warning:', syncErr);
        }
      }

      return data;
    }

    // 4. Update registration link in existing event_publications and events tables
    async updateEventRegistrationLink(eventId, registrationUrl) {
      const client = this.getClient();
      if (!client || !eventId) return;

      const numEventId = Number(eventId);

      // A. Update events table (both registration_url and registration_link)
      try {
        await client
          .from('events')
          .update({
            registration_url: registrationUrl,
            registration_link: registrationUrl,
            updated_at: new Date().toISOString()
          })
          .eq('id', numEventId || eventId);
      } catch (evErr) {
        try {
          await client.from('events').update({ registration_url: registrationUrl }).eq('id', numEventId || eventId);
        } catch (e1) {}
        try {
          await client.from('events').update({ registration_link: registrationUrl }).eq('id', numEventId || eventId);
        } catch (e2) {}
      }

      // B. Update / Upsert event_publications table (which drives published_events view and Upcoming.html)
      try {
        const { data: pubData } = await client
          .from('event_publications')
          .select('id, event_id')
          .eq('event_id', numEventId || eventId)
          .maybeSingle();

        if (pubData) {
          await client
            .from('event_publications')
            .update({
              registration_url: registrationUrl,
              updated_at: new Date().toISOString()
            })
            .eq('event_id', numEventId || eventId);
        } else {
          await client
            .from('event_publications')
            .insert([{
              event_id: numEventId || eventId,
              registration_url: registrationUrl,
              display_on_upcoming: true,
              display_on_home: true,
              mode: 'offline',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }]);
        }
      } catch (pubErr) {
        console.warn('[SupabaseService] event_publications sync notice:', pubErr);
      }
    }

    // 5. Submit Form Response
    async submitResponse(submissionData) {
      const payload = {
        form_id: submissionData.form_id,
        event_id: submissionData.event_id || null,
        form_title: submissionData.form_title || 'Registration Form',
        event_title: submissionData.event_title || '',
        event_date: submissionData.event_date || '',
        event_location: submissionData.event_location || '',
        confirmation_message: submissionData.confirmation_message || '',
        participant_name: submissionData.participant_name || 'Participant',
        participant_email: submissionData.participant_email || null,
        participant_phone: submissionData.participant_phone || null,
        responses_json: submissionData.responses_json || {},
        files_json: submissionData.files_json || [],
        metadata_json: {
          userAgent: navigator.userAgent,
          submittedAt: new Date().toISOString(),
          screenSize: `${window.innerWidth}x${window.innerHeight}`
        }
      };

      // 1. Primary: Submit through Google Apps Script bridge (saves to DB + sends email in one transaction)
      if (window.YUVA_FORMS_CONFIG.gas && window.YUVA_FORMS_CONFIG.gas.enabled) {
        try {
          console.log('[SupabaseService] Submitting response via Google Apps Script bridge...');
          const gasResult = await GASService.sendRequest('submit_form', { submission: payload });
          return {
            id: gasResult.submission_id || (gasResult.record && gasResult.record.id) || Math.random().toString(36).substring(2, 10).toUpperCase(),
            duplicate: gasResult.duplicate || false,
            ...(gasResult.record || gasResult)
          };
        } catch (gasErr) {
          console.warn('[SupabaseService] GAS bridge submission failed, attempting direct Supabase fallback:', gasErr);
        }
      }

      // 2. Fallback: Direct Supabase client
      const client = this.getClient();
      if (!client) throw new Error('Database client not configured');

      const { data, error } = await client
        .from('form_submissions')
        .insert({
          form_id: payload.form_id,
          event_id: payload.event_id,
          participant_name: payload.participant_name,
          participant_email: payload.participant_email,
          participant_phone: payload.participant_phone,
          responses_json: payload.responses_json,
          files_json: payload.files_json,
          metadata_json: payload.metadata_json,
          status: 'submitted'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    // 6. Upload file to existing Supabase Storage bucket (event-banners)
    async uploadFile(file, formId, attendeeId) {
      const client = this.getClient();
      if (!client) throw new Error('Database client not configured');

      const creds = window.YUVA_FORMS_CONFIG.getCredentials();
      const bucketName = creds.storageBucket || 'event-banners';
      const rawExt = file.name.split('.').pop() || 'bin';
      const fileExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '');
      const safeFormId = (formId || 'general').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const safeAttendeeId = (attendeeId || `att_${Date.now()}`).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const safeBaseName = (file.name.substring(0, file.name.lastIndexOf('.')) || 'file')
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .substring(0, 40);
      const fileName = `form-attachments/${safeFormId}/${safeAttendeeId}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${safeBaseName}.${fileExt}`;

      const { data, error } = await client.storage
        .from(bucketName)
        .upload(fileName, file, {
          cacheControl: '3600',
          contentType: file.type || 'application/octet-stream',
          upsert: false
        });

      if (error) throw error;

      // Get public URL
      const { data: publicUrlData } = client.storage
        .from(bucketName)
        .getPublicUrl(fileName);

      return {
        path: fileName,
        url: publicUrlData.publicUrl,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        attendeeId: safeAttendeeId
      };
    }

    // 7. Fetch Submissions for a Form
    async fetchSubmissions(formId) {
      const client = this.getClient();
      if (!client) throw new Error('Database client not configured');

      let query = client
        .from('form_submissions')
        .select('*')
        .order('created_at', { ascending: false });

      if (formId) {
        query = query.eq('form_id', formId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    // 8. Fetch All Forms
    async fetchAllForms() {
      const client = this.getClient();
      if (!client) throw new Error('Database client not configured');

      const { data, error } = await client
        .from('forms')
        .select('*, events(id, title, status, location)')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data || [];
    }

    // 9. Delete a Form
    async deleteForm(formId) {
      if (window.YUVA_FORMS_CONFIG.gas && window.YUVA_FORMS_CONFIG.gas.enabled) {
        try {
          console.log('[SupabaseService] Deleting form via Google Apps Script bridge...');
          return await GASService.sendRequest('delete_form', { form_id: formId });
        } catch (gasErr) {
          console.warn('[SupabaseService] GAS bridge delete failed, attempting direct Supabase fallback:', gasErr);
        }
      }

      const client = this.getClient();
      if (!client) throw new Error('Database client not configured');

      const { data, error } = await client
        .from('forms')
        .delete()
        .eq('id', formId);

      if (error) throw error;
      return data;
    }
  }

  // ===== GOOGLE APPS SCRIPT SERVERLESS BRIDGE SERVICE =====
  class GASService {
    static async sendRequest(action, payload) {
      const creds = window.YUVA_FORMS_CONFIG.getCredentials();
      const webhookUrl = creds.gasUrl;
      if (!webhookUrl || !window.YUVA_FORMS_CONFIG.gas.enabled) {
        throw new Error('Google Apps Script endpoint is not configured or disabled.');
      }

      console.log(`[GASService] Dispatching action: ${action} to Google Apps Script...`);
      
      const bodyPayload = JSON.stringify({
        action: action,
        ...payload
      });

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: bodyPayload
        });

        if (response.ok) {
          const resText = await response.text();
          try {
            const data = JSON.parse(resText);
            if (data.status === 'error') {
              throw new Error(data.message || 'Error reported by backend script');
            }
            return data.data !== undefined ? data.data : data;
          } catch (jsonErr) {
            return { raw: resText };
          }
        } else {
          throw new Error(`Server returned HTTP ${response.status}`);
        }
      } catch (postErr) {
        console.warn(`[GASService] Standard POST failed during ${action}:`, postErr);
        throw postErr;
      }
    }

    static async triggerWebhook(payload) {
      return this.sendRequest('submit_form', payload);
    }
  }

  // ============================================================================
  // ADMIN FORM BUILDER STUDIO (admin.html Controller)
  // ============================================================================
  class AdminFormBuilder {
    constructor() {
      this.db = new SupabaseService();
      this.eventsList = [];
      this.selectedEvent = null;
      this.currentUser = {
        email: null,
        uploaderId: null,
        isAdmin: false,
        verified: false,
        hasCompleteProfile: false,
        fullName: null,
        phone: null,
        roleInYuva: null
      };
      this.pendingAuthEmail = null;
      this.pendingUploaderId = null;
      this.verificationTimer = null;
      this.verificationSecondsLeft = 0;
      this.formSchema = {
        id: '',
        title: '',
        description: '',
        category: 'General',
        event_id: null,
        creator_name: '',
        creator_email: '',
        creator_phone: '',
        created_by_uploader: null,
        is_approved: false,
        is_active: true,
        fields: [],
        settings: {
          sendEmailNotification: true,
          confirmationMessage: 'Thank you for registering! Check your email for confirmation details.'
        }
      };
      this.activeFieldIndex = -1;
      this.previewDevice = 'desktop';
      this.lastSavedSnapshot = null;

      this.init();
    }

    async init() {
      // 1. Authenticate / Validate session
      const urlParams = new URLSearchParams(window.location.search);
      const adminEmail = urlParams.get('adminEmail');

      if (adminEmail) {
        await this.authorizeAdminDirectAccess(adminEmail);
      } else {
        const savedEmail = sessionStorage.getItem('eventUploaderEmail') || localStorage.getItem('eventUploaderEmail');
        if (savedEmail) {
          await this.verifyExistingSession(savedEmail);
        }
      }

      this.updateUploaderHeader();
      this.autoFillUploaderDetails();
      this.bindEvents();
      this.setupSettingsModal();
      this.loadStarterTemplate();
      this.setupCustomDropdown();
      await this.loadEventsDropdown();
      this.checkUrlForExistingForm();
      this.ensureCoreMandatoryFields();
      this.lastSavedSnapshot = this.getFormSnapshot();
    }

    getFormSnapshot() {
      const titleInput = document.getElementById('form-builder-title');
      const descInput = document.getElementById('form-builder-desc');
      const slugInput = document.getElementById('form-builder-slug');
      const creatorName = document.getElementById('form-builder-creator-name')?.value.trim() || '';
      const creatorEmail = document.getElementById('form-builder-creator-email')?.value.trim() || '';
      const creatorPhone = document.getElementById('form-builder-creator-phone')?.value.trim() || '';

      return JSON.stringify({
        id: slugInput ? slugInput.value.trim() : (this.formSchema.id || ''),
        event_id: this.formSchema.event_id || null,
        title: titleInput ? titleInput.value.trim() : (this.formSchema.title || ''),
        description: descInput ? descInput.value.trim() : (this.formSchema.description || ''),
        category: this.formSchema.category || 'General',
        creator_name: creatorName,
        creator_email: creatorEmail,
        creator_phone: creatorPhone,
        fields: (this.formSchema.fields || []).map(f => ({
          id: f.id,
          type: f.type,
          label: f.label,
          placeholder: f.placeholder,
          required: Boolean(f.required),
          helpText: f.helpText || '',
          validationRegex: f.validationRegex || '',
          errorMessage: f.errorMessage || '',
          options: f.options || [],
          maxSizeMB: f.maxSizeMB || null,
          allowedTypes: f.allowedTypes || []
        })),
        settings: this.formSchema.settings || {}
      });
    }

    isCoreMandatoryField(field) {
      if (!field) return false;
      if (['field_full_name', 'field_email', 'field_phone'].includes(field.id)) return true;
      if (field.type === 'email') return true;
      if (field.type === 'phone') return true;
      const labelLower = (field.label || '').toLowerCase();
      if (field.type === 'text' && (labelLower === 'full name' || labelLower === 'name' || labelLower.includes('full name') || labelLower.includes('your name'))) return true;
      return false;
    }

    ensureCoreMandatoryFields() {
      if (!this.formSchema.fields) this.formSchema.fields = [];

      const hasName = this.formSchema.fields.some(f => f.id === 'field_full_name' || (f.type === 'text' && (f.label || '').toLowerCase().includes('name')));
      const hasEmail = this.formSchema.fields.some(f => f.type === 'email' || f.id === 'field_email');
      const hasPhone = this.formSchema.fields.some(f => f.type === 'phone' || f.id === 'field_phone');

      if (!hasName) {
        this.formSchema.fields.unshift({
          id: 'field_full_name',
          type: 'text',
          label: 'Full Name',
          placeholder: 'Enter your full name',
          required: true,
          helpText: 'As per official government photo ID',
          validationRegex: '',
          errorMessage: ''
        });
      }

      if (!hasEmail) {
        this.formSchema.fields.splice(1, 0, {
          id: 'field_email',
          type: 'email',
          label: 'Email Address',
          placeholder: 'you@example.com',
          required: true,
          helpText: 'Confirmation email will be dispatched to this address',
          validationRegex: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
          errorMessage: 'Please enter a valid email address'
        });
      }

      if (!hasPhone) {
        this.formSchema.fields.splice(2, 0, {
          id: 'field_phone',
          type: 'phone',
          label: 'WhatsApp Mobile Number',
          placeholder: '10-digit mobile number',
          required: true,
          helpText: 'For event schedule updates and alerts',
          validationRegex: '^[6-9]\\d{9}$',
          errorMessage: 'Please enter a valid 10-digit mobile number'
        });
      }

      // Ensure all core fields are strictly required
      this.formSchema.fields.forEach(f => {
        if (this.isCoreMandatoryField(f)) {
          f.required = true;
        }
      });
    }

    loadStarterTemplate() {
      this.formSchema.fields = [
        {
          id: 'field_full_name',
          type: 'text',
          label: 'Full Name',
          placeholder: 'Enter your full name',
          required: true,
          helpText: 'As per official government photo ID',
          validationRegex: '',
          errorMessage: ''
        },
        {
          id: 'field_email',
          type: 'email',
          label: 'Email Address',
          placeholder: 'you@example.com',
          required: true,
          helpText: 'Confirmation email will be dispatched to this address',
          validationRegex: '',
          errorMessage: ''
        },
        {
          id: 'field_phone',
          type: 'phone',
          label: 'WhatsApp Mobile Number',
          placeholder: '10-digit mobile number',
          required: true,
          helpText: 'For event schedule updates and alerts',
          validationRegex: '^[6-9]\\d{9}$',
          errorMessage: 'Please enter a valid 10-digit mobile number'
        },
        {
          id: 'field_org',
          type: 'text',
          label: 'College / Organization / Unit',
          placeholder: 'e.g. University / Company name',
          required: false,
          helpText: '',
          validationRegex: '',
          errorMessage: ''
        },
        {
          id: 'field_purpose',
          type: 'textarea',
          label: 'Statement of Purpose / Expectations',
          placeholder: 'Share your background and expectation from this event...',
          required: false,
          helpText: '',
          validationRegex: '',
          errorMessage: ''
        }
      ];

      this.renderCanvas();
      this.renderLivePreview();
      this.updatePreviewHeader();
      this.updateGeneratedLinks();
    }

    bindEvents() {
      // Event selector change
      const eventSelect = document.getElementById('admin-event-select');
      if (eventSelect) {
        eventSelect.addEventListener('change', (e) => this.handleEventSelection(e.target.value));
      }

      // Add field buttons (supports both toolbox-item-btn and toolbox-btn)
      document.querySelectorAll('.toolbox-item-btn, .toolbox-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const fieldType = btn.getAttribute('data-field-type');
          this.addField(fieldType);
        });
      });

      // Save & Publish Form
      const saveBtn = document.getElementById('admin-save-form-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => this.handleSaveForm());
      }

      // Form Title live binding & Automatic Concise System Slug Generation
      const titleInput = document.getElementById('form-builder-title');
      if (titleInput) {
        titleInput.addEventListener('input', (e) => {
          this.formSchema.title = e.target.value;
          const autoSlug = generateFormId(e.target.value, this.formSchema.event_id);
          this.formSchema.id = autoSlug;
          const slugInput = document.getElementById('form-builder-slug');
          if (slugInput) slugInput.value = autoSlug;
          this.updatePreviewHeader();
          this.updateGeneratedLinks();
        });
      }

      const descInput = document.getElementById('form-builder-desc');
      if (descInput) {
        descInput.addEventListener('input', (e) => {
          this.formSchema.description = e.target.value;
          this.updatePreviewHeader();
        });
      }

      // Device switch buttons in preview
      document.querySelectorAll('.preview-device-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.preview-device-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const device = btn.getAttribute('data-device');
          this.setPreviewDevice(device);
        });
      });

      // Tab switcher (SaaS tabs)
      document.querySelectorAll('.saas-tab-btn, .admin-nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.saas-tab-btn, .admin-nav-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const tabId = tab.getAttribute('data-tab');
          this.switchTab(tabId);
        });
      });

      // Submissions refresh & CSV export
      const refreshSubsBtn = document.getElementById('refresh-submissions-btn');
      if (refreshSubsBtn) {
        refreshSubsBtn.addEventListener('click', () => this.loadSubmissions());
      }

      const exportCsvBtn = document.getElementById('export-csv-btn');
      if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => this.exportSubmissionsCsv());
      }

      // Close custom select dropdowns on outside click
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select-container')) {
          document.querySelectorAll('.custom-select-container').forEach(c => c.classList.remove('active', 'open-top'));
        }
      });

      // Modal backdrop click & escape key to close
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
            this.closeModal(overlay.id);
          }
        });
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          document.querySelectorAll('.modal-overlay.open').forEach(modal => {
            this.closeModal(modal.id);
          });
        }
      });
    }

    async loadEventsDropdown() {
      const optionsContainer = document.getElementById('event-dropdown-options');

      if (optionsContainer) {
        optionsContainer.innerHTML = `
          <div style="padding:1rem; text-align:center; color:var(--text-muted); font-size:0.85rem;">
            <div class="spinner" style="border-top-color:var(--saffron-primary); width:20px; height:20px; margin:0 auto 0.5rem;"></div>
            Loading events from Supabase...
          </div>
        `;
      }

      try {
        this.eventsList = await this.db.fetchEvents();
        this.renderCustomDropdownItems(this.eventsList || []);
      } catch (err) {
        console.error('Failed to load events list:', err);
        this.renderCustomDropdownItems([]);
      }
    }

    renderCustomDropdownItems(events = []) {
      const optionsContainer = document.getElementById('event-dropdown-options');
      if (!optionsContainer) return;

      let html = `
        <div class="dropdown-item" data-event-id="" onclick="window.yuvaAdmin && window.yuvaAdmin.selectCustomEvent('')">
          <div>
            <div class="dropdown-item-title" style="color:var(--text-muted);"><i class="fas fa-times-circle"></i> None / Unlink Event</div>
            <div class="dropdown-item-meta">Build standalone form without linking to an event</div>
          </div>
        </div>
      `;

      if (!events || events.length === 0) {
        html += `
          <div style="padding:0.75rem 1rem; text-align:center; color:var(--text-muted); font-size:0.82rem;">
            No events found in database. Standalone forms active.
          </div>
        `;
      } else {
        events.forEach(ev => {
          const isSelected = this.formSchema.event_id && String(this.formSchema.event_id) === String(ev.id);
          const dateStr = ev.start_at ? new Date(ev.start_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
          const loc = ev.location || '';
          const metaInfo = [dateStr, loc].filter(Boolean).join(' • ');

          html += `
            <div class="dropdown-item ${isSelected ? 'is-selected' : ''}" data-event-id="${escapeHtml(ev.id)}" onclick="window.yuvaAdmin && window.yuvaAdmin.selectCustomEvent('${escapeHtml(ev.id)}')">
              <div>
                <div class="dropdown-item-title">${escapeHtml(ev.title)}</div>
                ${metaInfo ? `<div class="dropdown-item-meta"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(metaInfo)}</div>` : ''}
              </div>
              <span class="dropdown-item-badge">${escapeHtml(ev.status || 'Active')}</span>
            </div>
          `;
        });
      }

      optionsContainer.innerHTML = html;
    }

    toggleEventDropdown(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const trigger = document.getElementById('event-dropdown-trigger');
      const menu = document.getElementById('event-dropdown-menu');
      const searchInput = document.getElementById('event-dropdown-search');

      if (!trigger || !menu) return;

      const isOpen = menu.classList.contains('is-open');
      if (isOpen) {
        menu.classList.remove('is-open');
        trigger.classList.remove('is-open');
      } else {
        menu.classList.add('is-open');
        trigger.classList.add('is-open');
        if (this.eventsList && this.eventsList.length > 0) {
          this.renderCustomDropdownItems(this.eventsList);
        } else {
          this.loadEventsDropdown();
        }
        if (searchInput) {
          searchInput.value = '';
          setTimeout(() => searchInput.focus(), 50);
        }
      }
    }

    setupCustomDropdown() {
      const trigger = document.getElementById('event-dropdown-trigger');
      const menu = document.getElementById('event-dropdown-menu');
      const searchInput = document.getElementById('event-dropdown-search');

      if (!trigger || !menu) return;

      // Toggle dropdown
      trigger.onclick = (e) => this.toggleEventDropdown(e);

      // Search filtering
      if (searchInput) {
        searchInput.oninput = (e) => {
          const query = e.target.value.toLowerCase().trim();
          const list = this.eventsList || [];
          const filtered = list.filter(ev => 
            (ev.title && ev.title.toLowerCase().includes(query)) || 
            (ev.location && ev.location.toLowerCase().includes(query)) ||
            (ev.status && ev.status.toLowerCase().includes(query))
          );
          this.renderCustomDropdownItems(filtered);
        };
      }

      // Close on click outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#custom-event-dropdown')) {
          menu.classList.remove('is-open');
          trigger.classList.remove('is-open');
        }
      });
    }

    async selectCustomEvent(eventId) {
      const trigger = document.getElementById('event-dropdown-trigger');
      const menu = document.getElementById('event-dropdown-menu');

      if (menu) menu.classList.remove('is-open');
      if (trigger) trigger.classList.remove('is-open');

      await this.handleEventSelection(eventId);
    }

    async handleEventSelection(eventId) {
      const triggerText = document.getElementById('event-dropdown-selected-text');
      const selectHidden = document.getElementById('admin-event-select');

      if (!eventId) {
        this.selectedEvent = null;
        this.formSchema.event_id = null;
        if (triggerText) triggerText.textContent = '-- Select an Event to Link (Optional) --';
        if (selectHidden) selectHidden.value = '';
        this.updateEventStatusBadge(null);
        this.renderCustomDropdownItems(this.eventsList || []);
        return;
      }

      let ev = (this.eventsList && this.eventsList.length > 0)
        ? this.eventsList.find(e => String(e.id) === String(eventId))
        : null;

      if (!ev) {
        // Direct fetch from Supabase if not yet in cache
        try {
          const client = this.db.getClient();
          if (client) {
            const { data: dbEv } = await client
              .from('events')
              .select('id, title, description, location, start_at, end_at, status, registration_url')
              .eq('id', eventId)
              .maybeSingle();
            if (dbEv) {
              ev = dbEv;
              if (!this.eventsList) this.eventsList = [];
              if (!this.eventsList.some(e => String(e.id) === String(dbEv.id))) {
                this.eventsList.unshift(dbEv);
              }
            }
          }
        } catch (fErr) {
          console.warn('Could not fetch event details for selection:', fErr);
        }
      }

      if (ev) {
        this.selectedEvent = ev;
        this.formSchema.event_id = ev.id;
        if (ev.category) {
          this.formSchema.category = ev.category;
        }
        if (triggerText) triggerText.textContent = ev.title;
        if (selectHidden) selectHidden.value = ev.id;

        // Automatically populate title and generate unique system slug from selected event
        const titleInput = document.getElementById('form-builder-title');
        if (titleInput && (!titleInput.value || titleInput.value === 'Untitled Registration Form' || titleInput.value.includes('Registration'))) {
          titleInput.value = `${ev.title} Registration`;
          this.formSchema.title = titleInput.value;
        }

        const autoSlug = generateFormId(ev.title, ev.id);
        this.formSchema.id = autoSlug;
        const slugInput = document.getElementById('form-builder-slug');
        if (slugInput && (!slugInput.value || slugInput.value.includes('form-') || slugInput.value.includes(ev.title.substring(0, 3).toLowerCase()))) {
          slugInput.value = autoSlug;
        }

        const descInput = document.getElementById('form-builder-desc');
        if (descInput && ev.description && !descInput.value) {
          descInput.value = ev.description;
          this.formSchema.description = ev.description;
        }

        this.updateEventStatusBadge(ev);
        this.updatePreviewHeader();
        this.updateGeneratedLinks();
        this.renderCustomDropdownItems(this.eventsList || []);
        Toast.info('Event Linked', `Form mapped to: ${ev.title}`);
      } else {
        if (triggerText) triggerText.textContent = 'Event Linked';
        if (selectHidden) selectHidden.value = eventId;
        this.formSchema.event_id = eventId;
      }
    }

    updateEventStatusBadge(ev) {
      const badge = document.getElementById('linked-event-badge');
      if (!badge) return;

      if (!ev) {
        badge.innerHTML = `<span class="badge" style="background:#f1f5f9; border:1px solid var(--border-light); color:var(--text-muted); padding:0.35rem 0.75rem; border-radius:var(--radius-sm); font-size:0.8rem; font-weight:600;"><i class="fas fa-unlink"></i> No Event Linked</span>`;
        return;
      }

      badge.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem; background:var(--saffron-pale); border:1px solid var(--saffron-light); padding:0.4rem 0.85rem; border-radius:var(--radius-sm);">
          <i class="fas fa-calendar-check" style="color:var(--saffron-primary);"></i>
          <span style="font-size:0.85rem; font-weight:700; color:var(--navy-primary);">${escapeHtml(ev.title)}</span>
          <span style="font-size:0.72rem; background:var(--saffron-primary); color:#fff; font-weight:700; padding:2px 7px; border-radius:4px; text-transform:uppercase;">${escapeHtml(ev.status || 'Active')}</span>
        </div>
      `;
    }

    addField(type) {
      const fieldId = `field_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
      const fieldCount = this.formSchema.fields.length + 1;

      let defaultRegex = '';
      let defaultError = '';
      if (type === 'phone') {
        defaultRegex = '^[6-9]\\d{9}$';
        defaultError = 'Please enter a valid 10-digit mobile number';
      } else if (type === 'email') {
        defaultRegex = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
        defaultError = 'Please enter a valid email address';
      } else if (type === 'id_proof') {
        defaultRegex = '^\\d{12}$';
        defaultError = 'Please enter a valid 12-digit Aadhaar number';
      } else if (type === 'url' || type === 'linkedin') {
        defaultRegex = '^https?:\\/\\/.+';
        defaultError = 'Please enter a valid URL starting with https://';
      }

      const defaultField = {
        id: fieldId,
        type: type,
        label: this.getDefaultLabel(type, fieldCount),
        placeholder: this.getDefaultPlaceholder(type),
        required: true,
        helpText: '',
        validationRegex: defaultRegex,
        errorMessage: defaultError,
        options: (type === 'select' || type === 'radio' || type === 'checkbox') ? ['Option 1', 'Option 2', 'Option 3'] : [],
        maxSizeMB: type === 'file' ? 0.5 : null,
        allowedTypes: type === 'file' ? ['image/jpeg', 'image/png', 'application/pdf'] : []
      };

      this.formSchema.fields.push(defaultField);
      this.renderCanvas();
      this.renderLivePreview();
      Toast.success('Field Added', `Added ${type.toUpperCase()} field to form.`);
    }

    getDefaultLabel(type, index) {
      switch (type) {
        case 'text': return `Full Name / Short Text ${index}`;
        case 'email': return 'Email Address';
        case 'phone': return 'Mobile / WhatsApp Number';
        case 'number': return 'Age / Quantity';
        case 'textarea': return 'Why do you wish to join / Statement?';
        case 'url': return 'Portfolio / Website URL';
        case 'select': return 'Select Your Category / Department';
        case 'radio': return 'Choose Preferred Mode of Participation';
        case 'checkbox': return 'Select Skills / Areas of Interest';
        case 'boolean': return 'Are you willing to travel for the event?';
        case 'state': return 'State / Union Territory (India)';
        case 'tshirt': return 'T-Shirt / Delegate Kit Size';
        case 'blood_group': return 'Blood Group';
        case 'rating': return 'Rate Your Overall Experience (1-5)';
        case 'scale': return 'How likely are you to recommend us? (1-10 NPS)';
        case 'date': return 'Date of Birth / Event Date';
        case 'time': return 'Preferred Reporting Time Slot';
        case 'datetime': return 'Orientation / Slot Date & Time';
        case 'college': return 'College / University / Campus Name';
        case 'id_proof': return 'Aadhaar / Government Photo ID';
        case 'currency': return 'Registration Fee / Contribution Amount (₹)';
        case 'linkedin': return 'LinkedIn Profile URL';
        case 'social': return 'Instagram / Twitter Handle';
        case 'file': return 'Upload ID Proof / Resume / Certificate';
        case 'signature': return 'Digital Signature / Acknowledgment';
        case 'consent': return 'Declaration & Code of Conduct Agreement';
        case 'address': return 'Complete Residential Address';
        case 'section': return 'Personal & Academic Information';
        default: return `Custom Field ${index}`;
      }
    }

    getDefaultPlaceholder(type) {
      switch (type) {
        case 'text': return 'Enter your text here...';
        case 'email': return 'you@example.com';
        case 'phone': return '9876543210';
        case 'number': return 'e.g. 21';
        case 'textarea': return 'Share your background and expectation...';
        case 'url': return 'https://yourwebsite.com';
        case 'currency': return 'e.g. 500';
        case 'linkedin': return 'https://linkedin.com/in/username';
        case 'social': return '@username';
        case 'id_proof': return '12-digit Aadhaar / ID number';
        case 'college': return 'e.g. Delhi University / IIT Delhi';
        case 'address': return 'House/Flat, Street, Area, Landmark';
        default: return '';
      }
    }

    renderCanvas() {
      const canvas = document.getElementById('builder-canvas');
      if (!canvas) return;

      if (this.formSchema.fields.length === 0) {
        canvas.innerHTML = `
          <div style="text-align:center; padding:3.5rem 1.5rem; background:#ffffff; border:2px dashed var(--border-medium); border-radius:var(--radius-md); box-shadow:var(--shadow-xs);">
            <i class="fas fa-layer-group" style="font-size:2.5rem; margin-bottom:1rem; color:var(--saffron-primary); opacity:0.8;"></i>
            <h3 style="font-size:1.15rem; font-weight:800; color:var(--navy-primary); margin-bottom:0.35rem;">Form Canvas is Empty</h3>
            <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1.5rem;">Click any input from the left toolbox or load the standard registration template.</p>
            <button class="btn btn-primary btn-sm" onclick="window.yuvaAdmin.loadStarterTemplate()">
              <i class="fas fa-magic"></i> Load Standard Template
            </button>
          </div>
        `;
        return;
      }

      canvas.innerHTML = '';

      this.formSchema.fields.forEach((field, index) => {
        const card = document.createElement('div');
        card.className = `canvas-field-card ${this.activeFieldIndex === index ? 'is-active' : ''}`;
        card.dataset.index = index;

        // Comprehensive Type Badge Icons
        const typeIcons = {
          text: 'fa-font',
          email: 'fa-envelope',
          phone: 'fa-phone',
          number: 'fa-hashtag',
          textarea: 'fa-paragraph',
          url: 'fa-link',
          select: 'fa-list',
          radio: 'fa-dot-circle',
          checkbox: 'fa-check-square',
          boolean: 'fa-toggle-on',
          state: 'fa-map',
          tshirt: 'fa-tshirt',
          blood_group: 'fa-heartbeat',
          rating: 'fa-star',
          scale: 'fa-sliders-h',
          date: 'fa-calendar',
          time: 'fa-clock',
          datetime: 'fa-calendar-check',
          college: 'fa-university',
          id_proof: 'fa-id-card',
          currency: 'fa-rupee-sign',
          linkedin: 'fa-linkedin',
          social: 'fa-instagram',
          file: 'fa-cloud-upload-alt',
          signature: 'fa-signature',
          consent: 'fa-shield-alt',
          address: 'fa-map-marked-alt',
          section: 'fa-heading'
        };

        let optionsEditorHtml = '';
        if (['select', 'radio', 'checkbox', 'tshirt', 'blood_group'].includes(field.type)) {
          const defaultOpts = field.type === 'tshirt' ? ['XS', 'S', 'M', 'L', 'XL', 'XXL'] :
                             field.type === 'blood_group' ? ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] :
                             ['Option 1', 'Option 2', 'Option 3'];
          if (!field.options || !field.options.length) {
            field.options = defaultOpts;
          }

          const optionsList = (field.options || []).map((opt, optIdx) => `
            <div class="option-row">
              <input type="text" value="${escapeHtml(opt)}" data-opt-index="${optIdx}" class="field-option-input">
              <button class="btn-icon btn-danger btn-sm" onclick="window.yuvaAdmin.removeFieldOption(${index}, ${optIdx})">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          `).join('');

          optionsEditorHtml = `
            <div class="options-editor">
              <div style="font-size:0.8rem; font-weight:700; color:var(--text-muted); margin-bottom:0.5rem; display:flex; justify-content:space-between; align-items:center;">
                <span>Choices / Options List</span>
                <button class="btn btn-secondary btn-sm" onclick="window.yuvaAdmin.addFieldOption(${index})">+ Add Option</button>
              </div>
              <div class="options-list-container">${optionsList}</div>
            </div>
          `;
        }

        let regexEditorHtml = '';
        if (['text', 'phone', 'email', 'number', 'url', 'currency', 'id_proof', 'linkedin', 'social', 'college'].includes(field.type)) {
          const compatiblePresets = this.getValidationPresetsForField(field.type);

          let currentPresetKey = 'none';
          if (field.validationRegex) {
            const matched = compatiblePresets.find(p => p.regex && p.regex === field.validationRegex);
            currentPresetKey = matched ? matched.key : 'custom';
          }

          const currentPreset = compatiblePresets.find(p => p.key === currentPresetKey) || compatiblePresets[0];

          const presetItemsHtml = compatiblePresets.map(p => `
            <div class="custom-select-item ${currentPresetKey === p.key ? 'selected' : ''}" 
                 onclick="window.yuvaAdmin.setValidationPreset(${index}, '${p.key}', event)">
              <span style="display:flex; align-items:center; gap:8px;">
                <i class="${p.icon}" style="color:var(--saffron-primary, #ff9933); width:16px; text-align:center; font-size:12px;"></i>
                <span>${escapeHtml(p.label)}</span>
              </span>
              ${currentPresetKey === p.key ? '<span class="item-check">✓</span>' : ''}
            </div>
          `).join('');

          const isCustom = currentPresetKey === 'custom';

          regexEditorHtml = `
            <div style="margin-top:0.75rem;">
              <div class="custom-select-container" id="validation-select-container-${index}" style="margin-bottom:0.6rem;">
                <label style="display:block; font-size:0.8rem; font-weight:700; color:var(--saffron-dark, #e67300); margin-bottom:0.35rem;">Validation Rule / Input Format</label>
                <div class="custom-select-trigger" onclick="window.yuvaAdmin.toggleValidationDropdown(${index}, event)">
                  <span id="validation-select-label-${index}" style="display:flex; align-items:center; gap:8px;">
                    <i class="${currentPreset.icon}" style="color:var(--saffron-primary, #ff9933); width:16px; text-align:center; font-size:12px;"></i>
                    <span>${escapeHtml(currentPreset.label)}</span>
                  </span>
                  <i class="fas fa-chevron-down custom-select-arrow"></i>
                </div>
                <div class="custom-select-options-panel" id="validation-select-panel-${index}">
                  ${presetItemsHtml}
                </div>
              </div>
              <div id="custom-regex-fields-${index}" style="display:${isCustom ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap:0.75rem;">
                <div class="floating-group is-filled" style="margin-bottom:0;">
                  <input type="text" class="floating-input" value="${escapeHtml(field.validationRegex || '')}" 
                    oninput="window.yuvaAdmin.updateFieldProp(${index}, 'validationRegex', this.value)" placeholder="e.g. ^[0-9]{4}$">
                  <label class="floating-label">Custom Regex Pattern</label>
                </div>
                <div class="floating-group is-filled" style="margin-bottom:0;">
                  <input type="text" class="floating-input" value="${escapeHtml(field.errorMessage || '')}" 
                    oninput="window.yuvaAdmin.updateFieldProp(${index}, 'errorMessage', this.value)" placeholder="e.g. Invalid value">
                  <label class="floating-label">Custom Error Message</label>
                </div>
              </div>
            </div>
          `;
        }

        let fileSettingsHtml = '';
        if (field.type === 'file') {
          const currentLimitVal = field.maxSizeMB !== undefined && field.maxSizeMB !== null ? field.maxSizeMB : 0.5;
          fileSettingsHtml = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; margin-top:0.75rem;">
              <div class="floating-group is-filled">
                <input type="number" min="0.1" max="50" step="0.1" class="floating-input" value="${currentLimitVal}" 
                  oninput="window.yuvaAdmin.updateFieldProp(${index}, 'maxSizeMB', parseFloat(this.value) || 0.5)" placeholder=" ">
                <label class="floating-label">Max File Size (MB, 0.5 = 500 KB)</label>
              </div>
              <div class="floating-group is-filled">
                <input type="text" class="floating-input" value="${(field.allowedTypes || []).join(', ')}" 
                  oninput="window.yuvaAdmin.updateFieldProp(${index}, 'allowedTypes', this.value.split(',').map(s=>s.trim()))" placeholder=" ">
                <label class="floating-label">MIME Types (e.g. image/*, .pdf)</label>
              </div>
            </div>
          `;
        }

        const isCore = this.isCoreMandatoryField(field);
        if (isCore) field.required = true;

        const deleteActionHtml = isCore
          ? `<button class="btn-icon btn-secondary btn-sm" disabled style="opacity:0.35; cursor:not-allowed;" title="Compulsory attendee field (cannot be removed)">
               <i class="fas fa-lock"></i>
             </button>`
          : `<button class="btn-icon btn-danger btn-sm" title="Delete" onclick="window.yuvaAdmin.deleteField(${index})">
               <i class="fas fa-trash"></i>
             </button>`;

        card.innerHTML = `
          <div class="field-header">
            <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
              <span class="field-drag-handle"><i class="fas fa-grip-vertical"></i></span>
              <span class="field-badge"><i class="fas ${typeIcons[field.type] || 'fa-keyboard'}"></i> ${field.type.toUpperCase()}</span>
              ${isCore ? `<span class="badge" style="background:rgba(239, 68, 68, 0.12); color:#dc2626; border:1px solid rgba(239, 68, 68, 0.3); font-weight:800; font-size:0.68rem; padding:1.5px 6px; border-radius:4px;"><i class="fas fa-lock" style="font-size:8px;"></i> COMPULSORY</span>` : ''}
              <span style="font-size:0.85rem; font-weight:700; color:var(--text-main);">${escapeHtml(field.label)}</span>
            </div>
            <div class="field-actions">
              <button class="btn-icon btn-secondary btn-sm" title="Move Up" onclick="window.yuvaAdmin.moveField(${index}, -1)">
                <i class="fas fa-chevron-up"></i>
              </button>
              <button class="btn-icon btn-secondary btn-sm" title="Move Down" onclick="window.yuvaAdmin.moveField(${index}, 1)">
                <i class="fas fa-chevron-down"></i>
              </button>
              <button class="btn-icon btn-secondary btn-sm" title="Duplicate" onclick="window.yuvaAdmin.duplicateField(${index})">
                <i class="fas fa-copy"></i>
              </button>
              ${deleteActionHtml}
            </div>
          </div>

          <div class="field-body">
            <div class="floating-group is-filled" style="margin-bottom:0.85rem;">
              <input type="text" class="floating-input" value="${escapeHtml(field.label)}" 
                oninput="window.yuvaAdmin.updateFieldProp(${index}, 'label', this.value)" placeholder=" ">
              <label class="floating-label">Field Question / Label Title</label>
            </div>

            <div style="display:grid; grid-template-columns: 1fr auto; gap:1.25rem; align-items:center; margin-bottom:0.85rem;">
              <div class="floating-group is-filled" style="margin-bottom:0;">
                <input type="text" class="floating-input" value="${escapeHtml(field.placeholder || '')}" 
                  oninput="window.yuvaAdmin.updateFieldProp(${index}, 'placeholder', this.value)" placeholder=" ">
                <label class="floating-label">Input Placeholder Hint</label>
              </div>
              <div style="display:flex; align-items:center; gap:0.6rem; padding:0 0.5rem;">
                <label class="toggle-switch">
                  <input type="checkbox" ${field.required ? 'checked' : ''} ${isCore ? 'disabled' : ''} 
                    onchange="window.yuvaAdmin.updateFieldProp(${index}, 'required', this.checked)">
                  <span class="toggle-slider"></span>
                </label>
                <span style="font-size:0.85rem; font-weight:700; color:var(--text-primary);">
                  Required ${isCore ? '<span style="color:#ef4444; font-size:0.75rem; font-weight:700; margin-left:4px;"><i class="fas fa-lock"></i> Compulsory</span>' : ''}
                </span>
              </div>
            </div>
            <div class="floating-group is-filled" style="margin-top:0.75rem;">
              <input type="text" class="floating-input" value="${escapeHtml(field.helpText || '')}" 
                oninput="window.yuvaAdmin.updateFieldProp(${index}, 'helpText', this.value)" placeholder=" ">
              <label class="floating-label">Help Text / Tooltip Explanation (Optional)</label>
            </div>

            ${optionsEditorHtml}
            ${regexEditorHtml}
            ${fileSettingsHtml}
          </div>
        `;

        // Bind option input listeners
        card.querySelectorAll('.field-option-input').forEach(optInput => {
          optInput.addEventListener('input', (e) => {
            const optIdx = parseInt(e.target.dataset.optIndex);
            this.formSchema.fields[index].options[optIdx] = e.target.value;
            this.renderLivePreview();
          });
        });

        canvas.appendChild(card);
      });

      const bottomBar = document.createElement('div');
      bottomBar.style.cssText = 'display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap; padding:0.75rem 0 1.5rem;';
      bottomBar.innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="window.yuvaAdmin.addField('text')"><i class="fas fa-plus"></i> Add Text</button>
        <button class="btn btn-secondary btn-sm" onclick="window.yuvaAdmin.addField('email')"><i class="fas fa-plus"></i> Add Email</button>
        <button class="btn btn-secondary btn-sm" onclick="window.yuvaAdmin.addField('phone')"><i class="fas fa-plus"></i> Add Phone</button>
        <button class="btn btn-secondary btn-sm" onclick="window.yuvaAdmin.addField('select')"><i class="fas fa-plus"></i> Add Dropdown</button>
        <button class="btn btn-secondary btn-sm" onclick="window.yuvaAdmin.addField('file')"><i class="fas fa-plus"></i> Add File</button>
      `;
      canvas.appendChild(bottomBar);
    }

    updateFieldProp(index, prop, value) {
      if (this.formSchema.fields[index]) {
        this.formSchema.fields[index][prop] = value;
        this.renderLivePreview();
      }
    }

    moveField(index, direction) {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= this.formSchema.fields.length) return;
      const [item] = this.formSchema.fields.splice(index, 1);
      this.formSchema.fields.splice(newIndex, 0, item);
      this.renderCanvas();
      this.renderLivePreview();
    }

    duplicateField(index) {
      const original = this.formSchema.fields[index];
      const cloned = JSON.parse(JSON.stringify(original));
      cloned.id = `${cloned.id}_copy_${Math.random().toString(36).substring(2, 5)}`;
      cloned.label = `${cloned.label} (Copy)`;
      this.formSchema.fields.splice(index + 1, 0, cloned);
      this.renderCanvas();
      this.renderLivePreview();
      Toast.info('Field Duplicated', 'Cloned field inserted below.');
    }

    deleteField(index) {
      const field = this.formSchema.fields[index];
      if (this.isCoreMandatoryField(field)) {
        Toast.warning('Compulsory Field', `"${field.label}" is a mandatory attendee field and cannot be removed.`);
        return;
      }
      this.formSchema.fields.splice(index, 1);
      this.renderCanvas();
      this.renderLivePreview();
      Toast.info('Field Removed', 'Field removed from canvas.');
    }

    addFieldOption(fieldIndex) {
      const field = this.formSchema.fields[fieldIndex];
      if (!field.options) field.options = [];
      field.options.push(`Option ${field.options.length + 1}`);
      this.renderCanvas();
      this.renderLivePreview();
    }

    toggleValidationDropdown(fieldIndex, event) {
      if (event) event.stopPropagation();
      const container = document.getElementById(`validation-select-container-${fieldIndex}`);
      if (!container) return;
      const isOpen = container.classList.contains('active');

      document.querySelectorAll('.custom-select-container').forEach(c => c.classList.remove('active', 'open-top'));

      if (!isOpen) {
        // Calculate viewport geometry to smart flip upward if near bottom
        const rect = container.getBoundingClientRect();
        const panelHeight = 260;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (spaceBelow < panelHeight && spaceAbove > 180) {
          container.classList.add('open-top');
        } else {
          container.classList.remove('open-top');
        }

        container.classList.add('active');
      }
    }

    getAllValidationPresets() {
      return [
        // General / Fallback
        { key: 'none', icon: 'fas fa-minus-circle', label: 'None (No strict validation / Any text)', regex: '', error: '', types: ['all'] },
        
        // Text / Names / Identification
        { key: 'alpha_only', icon: 'fas fa-user-tag', label: 'Letters Only (Full Name / City)', regex: '^[a-zA-Z\\s]+$', error: 'Only alphabetic letters and spaces allowed', types: ['text', 'college'] },
        { key: 'alphanumeric', icon: 'fas fa-font', label: 'Alphanumeric Only (Letters & Numbers)', regex: '^[a-zA-Z0-9\\s]+$', error: 'Only letters, numbers, and spaces allowed', types: ['text', 'college'] },
        { key: 'roll_no', icon: 'fas fa-graduation-cap', label: 'University Roll / Student ID', regex: '^[a-zA-Z0-9\\/\\-_]{3,25}$', error: 'Please enter a valid Student ID / Roll number', types: ['text', 'college'] },

        // Phone / WhatsApp
        { key: 'mobile_in', icon: 'fas fa-mobile-alt', label: '10-Digit Mobile Number (India)', regex: '^[6-9]\\d{9}$', error: 'Please enter a valid 10-digit mobile number', types: ['phone', 'text'] },
        { key: 'whatsapp_intl', icon: 'fab fa-whatsapp', label: 'International Phone (+E.164)', regex: '^\\+[1-9]\\d{1,14}$', error: 'Please enter in +<country_code><number> format (e.g. +919876543210)', types: ['phone', 'text'] },

        // Email
        { key: 'email', icon: 'fas fa-envelope', label: 'Email Address (Standard)', regex: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$', error: 'Please enter a valid email address', types: ['email', 'text'] },

        // Government IDs & Documents
        { key: 'aadhaar', icon: 'fas fa-id-card', label: '12-Digit Aadhaar Number', regex: '^\\d{12}$', error: 'Please enter a valid 12-digit Aadhaar number', types: ['id_proof', 'text'] },
        { key: 'pan', icon: 'fas fa-credit-card', label: 'Indian PAN Card (ABCDE1234F)', regex: '^[A-Z]{5}[0-9]{4}[A-Z]{1}$', error: 'Please enter a valid 10-character PAN number', types: ['id_proof', 'text'] },
        { key: 'voter_id', icon: 'fas fa-vote-yea', label: 'Indian Voter ID (EPIC Card)', regex: '^[A-Z]{3}[0-9]{7}$', error: 'Please enter a valid Voter ID (e.g. ABC1234567)', types: ['id_proof', 'text'] },
        { key: 'passport', icon: 'fas fa-passport', label: 'Indian Passport Number', regex: '^[A-PR-WYa-pr-wy][1-9]\\d\\s?\\d{4}[1-9]$', error: 'Please enter a valid Indian Passport number', types: ['id_proof', 'text'] },
        { key: 'driving_licence', icon: 'fas fa-id-badge', label: 'Driving Licence (DL)', regex: '^[A-Z]{2}[0-9]{2}\\s?[0-9]{11}$', error: 'Please enter a valid Driving Licence number', types: ['id_proof', 'text'] },
        { key: 'gstin', icon: 'fas fa-file-invoice-dollar', label: 'GSTIN Number (Tax ID)', regex: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$', error: 'Please enter a valid 15-digit GSTIN ID', types: ['id_proof', 'text'] },
        { key: 'vehicle_no', icon: 'fas fa-car', label: 'Vehicle Reg Number (DL01AB1234)', regex: '^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$', error: 'Please enter a valid Vehicle Registration number', types: ['id_proof', 'text'] },

        // Numbers, Scores, Age
        { key: 'numeric', icon: 'fas fa-hashtag', label: 'Numbers Only (Integer)', regex: '^\\d+$', error: 'Only numeric digits allowed', types: ['number', 'text'] },
        { key: 'pincode', icon: 'fas fa-map-pin', label: '6-Digit Postal PIN Code', regex: '^[1-9][0-9]{5}$', error: 'Please enter a valid 6-digit Indian PIN code', types: ['number', 'text', 'address'] },
        { key: 'age_18_99', icon: 'fas fa-birthday-cake', label: 'Valid Age (18 to 99 Years)', regex: '^(1[89]|[2-9][0-9])$', error: 'Age must be a valid number between 18 and 99', types: ['number'] },
        { key: 'percentage', icon: 'fas fa-percent', label: 'Percentage (0.00% to 100.00%)', regex: '^(100(\\.0{1,2})?|[0-9]{1,2}(\\.[0-9]{1,2})?)$', error: 'Please enter a valid percentage from 0 to 100', types: ['number'] },
        { key: 'cgpa_10', icon: 'fas fa-award', label: 'CGPA Scale (0.00 to 10.00)', regex: '^(10(\\.0{1,2})?|[0-9](\\.[0-9]{1,2})?)$', error: 'Please enter a valid CGPA out of 10.00', types: ['number'] },

        // Financial
        { key: 'currency_inr', icon: 'fas fa-rupee-sign', label: 'Valid Currency Amount (₹)', regex: '^[0-9]+(\\.[0-9]{1,2})?$', error: 'Please enter a valid monetary amount', types: ['currency', 'number'] },
        { key: 'bank_ifsc', icon: 'fas fa-university', label: 'Bank IFSC Code (SBIN0001234)', regex: '^[A-Z]{4}0[A-Z0-9]{6}$', error: 'Please enter a valid 11-character IFSC code', types: ['currency', 'text'] },
        { key: 'bank_acc', icon: 'fas fa-money-check', label: 'Bank Account Number (9-18 digits)', regex: '^[0-9]{9,18}$', error: 'Please enter a valid 9 to 18-digit bank account number', types: ['currency', 'number', 'text'] },
        { key: 'upi_id', icon: 'fas fa-money-bill-wave', label: 'UPI ID / VPA (username@bank)', regex: '^[a-zA-Z0-9.\\-_]{2,256}@[a-zA-Z]{2,64}$', error: 'Please enter a valid UPI ID (e.g. user@okaxis)', types: ['currency', 'text'] },

        // URLs & Social
        { key: 'url', icon: 'fas fa-globe', label: 'Website URL (https://...)', regex: '^https?:\\/\\/.+', error: 'Please enter a valid website URL starting with https://', types: ['url', 'text'] },
        { key: 'linkedin_url', icon: 'fab fa-linkedin', label: 'LinkedIn Profile URL', regex: '^https:\\/\\/(www\\.)?linkedin\\.com\\/(in|company)\\/[a-zA-Z0-9_\\-]+\\/?$', error: 'Please enter a valid LinkedIn URL (https://linkedin.com/in/...)', types: ['linkedin', 'url', 'text'] },
        { key: 'github_url', icon: 'fab fa-github', label: 'GitHub Profile URL', regex: '^https:\\/\\/(www\\.)?github\\.com\\/[a-zA-Z0-9_\\-]+\\/?$', error: 'Please enter a valid GitHub profile URL', types: ['url', 'text'] },
        { key: 'instagram', icon: 'fab fa-instagram', label: 'Instagram Handle (@username)', regex: '^@?[a-zA-Z0-9._]{1,30}$', error: 'Please enter a valid Instagram username', types: ['social', 'text'] },
        { key: 'twitter_x', icon: 'fab fa-x-twitter', label: 'Twitter / X Handle (@handle)', regex: '^@?[A-Za-z0-9_]{1,15}$', error: 'Please enter a valid Twitter/X handle', types: ['social', 'text'] },

        // Advanced Custom
        { key: 'custom', icon: 'fas fa-sliders-h', label: 'Custom Regex Rule (Advanced)...', regex: null, error: null, types: ['all'] }
      ];
    }

    getValidationPresetsForField(fieldType) {
      const allPresets = this.getAllValidationPresets();
      return allPresets.filter(p => p.types.includes('all') || p.types.includes(fieldType));
    }

    setValidationPreset(fieldIndex, presetKey, event) {
      if (event) event.stopPropagation();
      const field = this.formSchema.fields[fieldIndex];
      if (!field) return;

      const allPresets = this.getAllValidationPresets();
      const preset = allPresets.find(p => p.key === presetKey);
      if (!preset) return;

      document.querySelectorAll('.custom-select-container').forEach(c => c.classList.remove('active', 'open-top'));

      const customDiv = document.getElementById(`custom-regex-fields-${fieldIndex}`);
      const labelSpan = document.getElementById(`validation-select-label-${fieldIndex}`);
      if (labelSpan) {
        labelSpan.innerHTML = `
          <i class="${preset.icon}" style="color:var(--saffron-primary, #ff9933); width:16px; text-align:center; font-size:12px;"></i>
          <span>${escapeHtml(preset.label)}</span>
        `;
      }

      if (preset.key === 'custom') {
        if (customDiv) customDiv.style.display = 'grid';
      } else {
        field.validationRegex = preset.regex;
        field.errorMessage = preset.error;
        if (customDiv) customDiv.style.display = 'none';
        this.renderCanvas();
        this.renderLivePreview();
      }
    }

    removeFieldOption(fieldIndex, optIndex) {
      const field = this.formSchema.fields[fieldIndex];
      if (field.options && field.options.length > 1) {
        field.options.splice(optIndex, 1);
        this.renderCanvas();
        this.renderLivePreview();
      } else {
        Toast.error('Cannot Delete', 'At least one option must remain.');
      }
    }

    setPreviewDevice(device) {
      this.previewDevice = device;
      const frame = document.getElementById('preview-simulator-frame');
      if (!frame) return;
      frame.className = `simulator-frame view-${device}`;
    }

    updatePreviewHeader() {
      const titleEl = document.getElementById('preview-form-title');
      const descEl = document.getElementById('preview-form-desc');
      const badgeEl = document.getElementById('preview-event-badge');

      if (titleEl) titleEl.textContent = this.formSchema.title || 'Untitled Form';
      if (descEl) descEl.textContent = this.formSchema.description || '';
      if (badgeEl) {
        if (this.selectedEvent) {
          badgeEl.textContent = this.selectedEvent.title;
          badgeEl.style.display = 'inline-flex';
        } else {
          badgeEl.style.display = 'none';
        }
      }
    }

    renderLivePreview() {
      this.updatePreviewHeader();
      const container = document.getElementById('preview-form-body');
      if (!container) return;

      if (this.formSchema.fields.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:2rem 1rem; color:var(--text-dim); font-size:0.85rem;">
            Fields added in builder will appear here in real-time.
          </div>
        `;
        return;
      }

      container.innerHTML = '';
      const dummyForm = document.createElement('div');
      dummyForm.innerHTML = YuvaFormRenderer.generateHtmlFields(this.formSchema.fields, 'preview');
      container.appendChild(dummyForm);

      // Attach realtime validation event listeners to preview inputs
      dummyForm.querySelectorAll('.form-field-input, .form-field-textarea, .form-field-select, .floating-input, .floating-textarea, .floating-select').forEach(input => {
        const validate = () => {
          YuvaFormRenderer.prototype.validateSingleInput(input);
        };
        input.addEventListener('input', validate);
        input.addEventListener('change', validate);
        input.addEventListener('blur', validate);
      });
    }

    updateGeneratedLinks() {
      const slug = this.formSchema.id || '';
      const prodUrl = slug ? `${window.YUVA_FORMS_CONFIG.routing.productionBaseUrl}/?form_id=${slug}` : '';
      const localUrl = slug ? `${window.YUVA_FORMS_CONFIG.routing.getBaseUrl()}/index.html?form_id=${slug}` : '';

      const linkInput = document.getElementById('generated-public-link');
      if (linkInput) linkInput.value = prodUrl;

      const simUrlText = document.getElementById('sim-slug-preview');
      if (simUrlText) simUrlText.textContent = slug || '--';

      const testBtn = document.getElementById('test-form-link-btn');
      if (testBtn) {
        testBtn.href = localUrl;
      }
    }

    async handleSaveForm() {
      const slugInput = document.getElementById('form-builder-slug');
      const titleInput = document.getElementById('form-builder-title');
      const creatorNameInput = document.getElementById('form-builder-creator-name');
      const creatorEmailInput = document.getElementById('form-builder-creator-email');
      const creatorPhoneInput = document.getElementById('form-builder-creator-phone');

      if (!titleInput || !titleInput.value.trim()) {
        Toast.error('Validation Error', 'Please enter a Form Title.');
        if (titleInput) titleInput.focus();
        return;
      }

      const creatorName = creatorNameInput ? creatorNameInput.value.trim() : '';
      const creatorEmail = creatorEmailInput ? creatorEmailInput.value.trim() : '';
      const creatorPhone = creatorPhoneInput ? creatorPhoneInput.value.trim() : '';

      if (!creatorName || creatorName.length < 2) {
        Toast.error('Creator Info Required', 'Please provide your Full Legal Name under Creator details.');
        if (creatorNameInput) creatorNameInput.focus();
        return;
      }

      if (!creatorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(creatorEmail)) {
        Toast.error('Invalid Email Address', 'Please provide a valid official email. Discrepancies result in immediate rejection.');
        if (creatorEmailInput) creatorEmailInput.focus();
        return;
      }

      const cleanPhone = creatorPhone.replace(/[^0-9]/g, '');
      if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 13) {
        Toast.error('Invalid Mobile Number', 'Please provide a valid 10-digit mobile number. Discrepancies result in immediate rejection.');
        if (creatorPhoneInput) creatorPhoneInput.focus();
        return;
      }

      let formId = this.formSchema.id;
      if (!formId) {
        formId = generateFormId(titleInput.value.trim(), this.formSchema.event_id);
        this.formSchema.id = formId;
      }
      this.formSchema.title = titleInput.value.trim();
      this.formSchema.creator_name = creatorName;
      this.formSchema.creator_email = creatorEmail;
      this.formSchema.creator_phone = creatorPhone;

      if (this.formSchema.fields.length === 0) {
        Toast.error('Empty Form', 'Please add at least one field before saving.');
        return;
      }

      // Check if there are any real changes compared to last saved state
      const currentSnapshot = this.getFormSnapshot();
      if (this.lastSavedSnapshot && this.lastSavedSnapshot === currentSnapshot) {
        Toast.info('No Changes Detected', 'All changes are already saved and up to date. No network save needed.');
        return;
      }

      const saveBtn = document.getElementById('admin-save-form-btn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner"></span> Saving & Submitting...';
      }

      try {
        const payload = {
          id: this.formSchema.id,
          event_id: this.formSchema.event_id || null,
          title: this.formSchema.title,
          description: this.formSchema.description,
          category: this.formSchema.category || 'General',
          creator_name: creatorName,
          creator_email: creatorEmail,
          creator_phone: creatorPhone,
          created_by_uploader: this.currentUser?.uploaderId || this.formSchema.created_by_uploader || null,
          schema_json: { fields: this.formSchema.fields },
          settings: this.formSchema.settings || {},
          is_approved: this.formSchema.is_approved !== undefined ? Boolean(this.formSchema.is_approved) : false,
          is_active: this.formSchema.is_active !== undefined ? Boolean(this.formSchema.is_active) : true
        };

        const saved = await this.db.saveForm(payload);
        
        // If not already verified in session, keep creator email in session
        if (!this.currentUser || !this.currentUser.verified) {
          this.currentUser = {
            email: creatorEmail,
            uploaderId: null,
            isAdmin: false,
            verified: true,
            name: creatorName
          };
          sessionStorage.setItem('eventUploaderEmail', creatorEmail);
          this.updateUploaderHeader();
        }

        Toast.success('Form Saved & Submitted!', `Form "${saved.title}" saved successfully. Status: Under Review for Super Admin Approval.`);
        this.lastSavedSnapshot = this.getFormSnapshot();
        this.updateGeneratedLinks();
        this.loadAllFormsGrid();
        this.showPublishSuccessModal(saved);
      } catch (err) {
        console.error('Failed to save form:', err);
        Toast.error('Save Failed', err.message || 'Error occurred saving to Supabase.');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save & Publish Form';
        }
      }
    }

    openModal(modalId) {
      const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
      if (modal) {
        modal.classList.add('open');
        document.body.classList.add('modal-open');
      }
    }

    closeModal(modalId) {
      const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
      if (modal) {
        modal.classList.remove('open');
      }
      if (!document.querySelector('.modal-overlay.open')) {
        document.body.classList.remove('modal-open');
      }
    }

    showPublishSuccessModal(savedForm) {
      const urlEl = document.getElementById('modal-published-url');
      const qrEl = document.getElementById('modal-qr-code');

      const fullUrl = `${window.YUVA_FORMS_CONFIG.routing.productionBaseUrl}/?form_id=${savedForm.id}`;

      if (urlEl) urlEl.value = fullUrl;
      if (qrEl) {
        qrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(fullUrl)}&bgcolor=10-15-29&color=255-111-0`;
      }

      this.openModal('publish-success-modal');
    }

    openInAppPreviewModal() {
      this.closeModal('publish-success-modal');

      const modal = document.getElementById('admin-in-app-preview-modal');
      const container = document.getElementById('in-modal-preview-content');
      if (!modal || !container) return;

      const title = this.formSchema.title || 'Untitled Form';
      const desc = this.formSchema.description || '';
      const eventName = this.selectedEvent?.title || '';

      const fieldsHtml = YuvaFormRenderer.generateHtmlFields(this.formSchema.fields, 'preview');

      container.innerHTML = `
        <div style="margin-bottom: 1.75rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border-light, #e2e8f0);">
          ${eventName ? `
            <div style="display:inline-flex; align-items:center; gap:0.4rem; font-size:0.8rem; font-weight:700; color:var(--saffron-dark, #e67300); background:var(--saffron-pale, #fff7ed); border:1px solid var(--saffron-light, #ffedd5); padding:0.35rem 0.75rem; border-radius:20px; margin-bottom:0.75rem;">
              <i class="fas fa-calendar-alt"></i> ${escapeHtml(eventName)}
            </div>
          ` : ''}
          <h1 style="font-size:1.5rem; font-weight:800; color:var(--navy-primary, #0f172a); margin-bottom:0.5rem; line-height:1.3;">
            ${escapeHtml(title)}
          </h1>
          ${desc ? `<p style="font-size:0.9rem; color:var(--text-secondary, #475569); line-height:1.5;">${escapeHtml(desc)}</p>` : ''}
        </div>

        <form id="in-modal-interactive-form" onsubmit="event.preventDefault(); Toast.success('Super Admin Test Pass', 'All fields validated successfully in preview mode!');">
          <div class="rendered-fields-wrapper">
            ${fieldsHtml}
          </div>

          <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border-light, #e2e8f0); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
            <span style="font-size:0.8rem; color:var(--text-muted);"><i class="fas fa-shield-alt" style="color:#10b981;"></i> Super Admin Interactive Pass Active</span>
            <button type="submit" class="btn btn-primary" style="padding:0.75rem 1.75rem; font-size:0.95rem; font-weight:700;">
              <i class="fas fa-paper-plane"></i> Test Submit Registration
            </button>
          </div>
        </form>
      `;

      // Attach realtime validation event listeners to inputs
      container.querySelectorAll('.form-field-input, .form-field-textarea, .form-field-select').forEach(input => {
        const validate = () => {
          YuvaFormRenderer.prototype.validateSingleInput(input);
        };
        input.addEventListener('input', validate);
        input.addEventListener('change', validate);
        input.addEventListener('blur', validate);
      });

      this.openModal('admin-in-app-preview-modal');
    }

    setModalPreviewDevice(device, btn) {
      document.querySelectorAll('.preview-device-btn.in-modal').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');

      const frame = document.getElementById('in-modal-form-frame');
      if (!frame) return;

      if (device === 'mobile') {
        frame.style.maxWidth = '390px';
      } else if (device === 'tablet') {
        frame.style.maxWidth = '540px';
      } else {
        frame.style.maxWidth = '680px';
      }
    }

    async checkUrlForExistingForm() {
      const urlParams = new URLSearchParams(window.location.search);
      const formId = urlParams.get('form_id') || urlParams.get('id') || urlParams.get('load_form');
      const eventId = urlParams.get('event_id');

      if (formId || eventId) {
        try {
          const existing = await this.db.fetchForm(formId, eventId);
          if (existing) {
            this.formSchema.id = existing.id;
            this.formSchema.title = existing.title;
            this.formSchema.description = existing.description || '';
            this.formSchema.event_id = existing.event_id;
            this.formSchema.category = existing.category || 'General';
            this.formSchema.creator_name = existing.creator_name || '';
            this.formSchema.creator_email = existing.creator_email || '';
            this.formSchema.creator_phone = existing.creator_phone || '';
            this.formSchema.is_approved = Boolean(existing.is_approved);
            this.formSchema.is_active = existing.is_active !== undefined ? Boolean(existing.is_active) : true;
            this.formSchema.fields = existing.schema_json?.fields || [];
            this.formSchema.settings = existing.settings || {};

            const titleInput = document.getElementById('form-builder-title');
            if (titleInput) titleInput.value = existing.title;

            const descInput = document.getElementById('form-builder-desc');
            if (descInput) descInput.value = existing.description || '';

            const slugInput = document.getElementById('form-builder-slug');
            if (slugInput) slugInput.value = existing.id;

            const cName = document.getElementById('form-builder-creator-name');
            const cEmail = document.getElementById('form-builder-creator-email');
            const cPhone = document.getElementById('form-builder-creator-phone');
            if (cName) cName.value = existing.creator_name || '';
            if (cEmail) cEmail.value = existing.creator_email || '';
            if (cPhone) cPhone.value = existing.creator_phone || '';

            const eventSelect = document.getElementById('admin-event-select');
            if (eventSelect && existing.event_id) {
              eventSelect.value = existing.event_id;
              this.handleEventSelection(existing.event_id);
            }

            this.renderCanvas();
            this.renderLivePreview();
            this.updateGeneratedLinks();
            this.lastSavedSnapshot = this.getFormSnapshot();
            Toast.success('Form Loaded', `Editing schema for ${existing.title}`);
          } else if (eventId) {
            // New Form initialization linked to this event
            const eventSelect = document.getElementById('admin-event-select');
            if (eventSelect) {
              eventSelect.value = eventId;
              await this.handleEventSelection(eventId);
            }

            if (this.currentUser && this.currentUser.verified && this.currentUser.hasCompleteProfile) {
              this.autoFillUploaderDetails();
              Toast.info('Event Linked', 'Form initialized for your event. Customize fields and click Save & Publish.');
            } else {
              Toast.info('Identity Verification', 'Please log in with your uploader email to link and publish this form.');
              this.openAuthModal();
            }
          }
        } catch (e) {
          console.warn('Could not load existing form:', e);
        }
      }
    }

    // ===== EVENT UPLOADER AUTHENTICATION & DIRECT ADMIN ACCESS =====
    async authorizeAdminDirectAccess(adminEmail) {
      if (!adminEmail || typeof adminEmail !== 'string' || !adminEmail.includes('@')) {
        return false;
      }
      try {
        const client = this.db.getClient();
        if (!client) return false;

        const { data: adminRecord, error: adminErr } = await client
          .from('admin_users')
          .select('id, email, full_name, role, is_active')
          .eq('email', adminEmail.trim())
          .maybeSingle();

        if (adminErr || !adminRecord || adminRecord.is_active === false) {
          console.warn('Unauthorized admin bypass attempt rejected for email:', adminEmail);
          return false;
        }

        // Priority to full profile in event_uploaders table
        let { data: uploader } = await client
          .from('event_uploaders')
          .select('id, email, is_active, full_name, phone, role_in_yuva')
          .eq('email', adminRecord.email)
          .maybeSingle();

        if (!uploader) {
          const { data: newUploader } = await client
            .from('event_uploaders')
            .insert([{
              email: adminRecord.email,
              full_name: adminRecord.full_name || 'Super Admin',
              phone: '',
              role_in_yuva: 'Super Admin',
              verified_at: new Date().toISOString(),
              is_active: true
            }])
            .select('id, email, is_active, full_name, phone, role_in_yuva')
            .maybeSingle();
          if (newUploader) uploader = newUploader;
        }

        const effectiveName = uploader?.full_name || adminRecord.full_name || 'Super Admin';
        const effectiveRole = uploader?.role_in_yuva || 'Super Admin';
        const effectivePhone = uploader?.phone || '';

        this.currentUser = {
          email: adminRecord.email,
          uploaderId: uploader ? uploader.id : null,
          isAdmin: true,
          verified: true,
          hasCompleteProfile: true,
          fullName: effectiveName,
          phone: effectivePhone,
          roleInYuva: effectiveRole
        };

        sessionStorage.setItem('eventUploaderEmail', this.currentUser.email);
        if (this.currentUser.uploaderId) sessionStorage.setItem('eventUploaderId', this.currentUser.uploaderId);
        sessionStorage.setItem('eventUploaderIsAdmin', 'true');

        this.updateUploaderHeader();
        this.autoFillUploaderDetails();
        Toast.success('Admin Authenticated', `Welcome back, ${effectiveName}!`);
        return true;
      } catch (err) {
        console.error('Error authorizing admin direct access:', err);
        return false;
      }
    }

    async verifyExistingSession(email) {
      if (!email) return false;
      try {
        const client = this.db.getClient();
        if (!client) return false;

        const isAdmin = sessionStorage.getItem('eventUploaderIsAdmin') === 'true';
        if (isAdmin) {
          return await this.authorizeAdminDirectAccess(email);
        }

        const { data, error } = await client
          .from('event_uploaders')
          .select('id, email, verified_at, is_active, full_name, phone, role_in_yuva')
          .eq('email', email.toLowerCase().trim())
          .maybeSingle();

        if (data && data.is_active) {
          const hasCompleteProfile = Boolean(data.full_name && data.phone && data.role_in_yuva);

          this.currentUser = {
            email: data.email,
            uploaderId: data.id,
            isAdmin: false,
            verified: true,
            hasCompleteProfile: hasCompleteProfile,
            fullName: data.full_name || '',
            phone: data.phone || '',
            roleInYuva: data.role_in_yuva || ''
          };

          sessionStorage.setItem('eventUploaderEmail', this.currentUser.email);
          sessionStorage.setItem('eventUploaderId', this.currentUser.uploaderId);

          if (!hasCompleteProfile) {
            // ZERO-BYPASS ENFORCEMENT: Force Profile Completion modal immediately
            this.pendingAuthEmail = data.email;
            this.pendingUploaderId = data.id;
            this.switchAuthStep('profile');
            this.openModal('organizer-auth-modal');
            return false;
          }

          this.updateUploaderHeader();
          this.autoFillUploaderDetails();
          return true;
        } else {
          this.logoutUploader(false);
          return false;
        }
      } catch (err) {
        console.error('Session verification error:', err);
        this.logoutUploader(false);
        return false;
      }
    }

    openAuthModal() {
      if (this.currentUser && this.currentUser.verified && !this.currentUser.hasCompleteProfile) {
        this.switchAuthStep('profile');
      } else {
        this.switchAuthStep('email');
        const emailInp = document.getElementById('auth-organizer-email');
        if (emailInp) {
          emailInp.value = this.currentUser.email || sessionStorage.getItem('eventUploaderEmail') || '';
        }
      }
      this.openModal('organizer-auth-modal');
    }

    openOrganizerAuthModal() {
      this.openAuthModal();
    }

    switchAuthStep(step) {
      const emailForm = document.getElementById('uploader-email-form');
      const codeForm = document.getElementById('uploader-code-form');
      const profileForm = document.getElementById('uploader-profile-form');
      const titleEl = document.getElementById('auth-modal-title');
      const subEl = document.getElementById('auth-modal-subtitle');
      const bannerEl = document.getElementById('auth-info-banner-text');
      const descEl = document.getElementById('auth-banner-description');

      if (step === 'code') {
        if (emailForm) emailForm.style.display = 'none';
        if (codeForm) codeForm.style.display = 'block';
        if (profileForm) profileForm.style.display = 'none';
        if (bannerEl) bannerEl.style.display = 'flex';
        if (titleEl) titleEl.textContent = 'First-Time Verification';
        if (subEl) subEl.textContent = '1-Time Registration: Enter 6-digit code sent to your inbox';
        if (descEl) descEl.innerHTML = `Check your inbox at <strong>${escapeHtml(this.pendingAuthEmail || '')}</strong>. Code expires in 10 minutes.`;
        const codeInp = document.getElementById('auth-verification-code');
        if (codeInp) {
          codeInp.value = '';
          codeInp.focus();
        }
      } else if (step === 'profile') {
        if (emailForm) emailForm.style.display = 'none';
        if (codeForm) codeForm.style.display = 'none';
        if (profileForm) profileForm.style.display = 'block';
        if (bannerEl) bannerEl.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Register Uploader Profile';
        if (subEl) subEl.textContent = 'Enter your legal identity and designation in YUVA for Super Admin activation';
        const emailBadge = document.getElementById('auth-profile-email-badge');
        if (emailBadge) emailBadge.textContent = this.pendingAuthEmail || this.currentUser?.email || '';
        const nameInp = document.getElementById('auth-uploader-name');
        if (nameInp) {
          nameInp.value = this.currentUser?.fullName || '';
          nameInp.focus();
        }
        const phoneInp = document.getElementById('auth-uploader-phone');
        if (phoneInp) phoneInp.value = this.currentUser?.phone || '';
        const roleInp = document.getElementById('auth-uploader-role');
        if (roleInp) roleInp.value = this.currentUser?.roleInYuva || '';
        this.clearVerificationTimer();
      } else {
        if (emailForm) emailForm.style.display = 'block';
        if (codeForm) codeForm.style.display = 'none';
        if (profileForm) profileForm.style.display = 'none';
        if (bannerEl) bannerEl.style.display = 'flex';
        if (titleEl) titleEl.textContent = 'Event Uploader Login';
        if (subEl) subEl.textContent = 'Sign in to access and manage your event registration forms';
        if (descEl) descEl.innerHTML = 'Enter your registered email address to log in. <strong>Approved uploaders log in instantly with 0 OTP</strong>. First-time users will complete a 1-time verification and profile registration.';
        this.clearVerificationTimer();
      }
    }

    async handleSendVerificationCode(e) {
      if (e) e.preventDefault();
      const emailInput = document.getElementById('auth-organizer-email');
      const email = (emailInput?.value || '').trim().toLowerCase();

      if (!email || !email.includes('@')) {
        Toast.error('Invalid Email', 'Please enter a valid official email address.');
        return;
      }

      const btn = document.getElementById('btn-send-auth-code');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Checking account...';
      }

      try {
        const client = this.db.getClient();

        // 1. Check if user is already in event_uploaders table (always prioritized for name & credentials)
        let existingUploader = null;
        if (client) {
          const { data } = await client
            .from('event_uploaders')
            .select('id, email, full_name, phone, role_in_yuva, is_active')
            .eq('email', email)
            .maybeSingle();
          existingUploader = data;
        }

        if (existingUploader) {
          const hasCompleteProfile = Boolean(existingUploader.full_name && existingUploader.phone && existingUploader.role_in_yuva);

          if (existingUploader.is_active === true && hasCompleteProfile) {
            // APPROVED UPLOADER WITH COMPLETE PROFILE -> DIRECT INSTANT LOGIN (NO OTP NEEDED)!
            this.currentUser = {
              email: email,
              uploaderId: existingUploader.id,
              isAdmin: false,
              verified: true,
              hasCompleteProfile: true,
              fullName: existingUploader.full_name,
              phone: existingUploader.phone,
              roleInYuva: existingUploader.role_in_yuva
            };

            sessionStorage.setItem('eventUploaderEmail', email);
            sessionStorage.setItem('eventUploaderId', existingUploader.id);
            localStorage.setItem('eventUploaderEmail', email);

            this.closeModal('organizer-auth-modal');
            this.updateUploaderHeader();
            this.autoFillUploaderDetails();
            Toast.success('Logged In!', `Welcome back, ${existingUploader.full_name}! Direct access active.`);

            const activeTab = document.querySelector('.saas-tab-btn.active')?.getAttribute('data-tab');
            if (activeTab === 'all-forms') this.loadAllFormsGrid();
            else if (activeTab === 'submissions') this.loadSubmissions();
            return;
          } else if (hasCompleteProfile && existingUploader.is_active === false) {
            // Submitted complete profile but awaiting Super Admin approval -> STRICTLY BLOCK!
            Toast.warning('Account Pending Activation', 'Your profile is awaiting Super Admin activation. You will be able to log in as soon as it is approved.');
            return;
          }
          // If profile is NOT complete yet (e.g. from an old partial test), they must verify OTP first to proceed
        }

        // 2. Check if user is a Super Admin in admin_users
        if (client) {
          const { data: adminRecord } = await client
            .from('admin_users')
            .select('id, email, full_name, role, is_active')
            .eq('email', email)
            .maybeSingle();

          if (adminRecord && adminRecord.is_active !== false) {
            await this.authorizeAdminDirectAccess(email);
            this.closeModal('organizer-auth-modal');
            return;
          }
        }

        // 3. New User / Incomplete: Dispatch 6-digit OTP for 1-time email verification
        if (btn) btn.innerHTML = '<span class="spinner"></span> Sending Verification Code...';

        const result = await callVerificationService({
          action: 'sendVerificationCode',
          email: email,
          portal: 'forms',
          portalName: 'Event Registration & Forms Portal',
          portalType: 'forms_studio'
        });

        if (result && result.success) {
          this.pendingAuthEmail = email;
          const targetSpan = document.getElementById('auth-code-sent-target');
          if (targetSpan) targetSpan.textContent = email;

          this.switchAuthStep('code');
          this.startVerificationTimer(10 * 60);
          Toast.success('Code Sent!', `6-digit verification code sent to ${email} for registration.`);
        } else {
          Toast.error('Verification Error', result?.error || 'Failed to dispatch verification code. Please try again.');
        }
      } catch (err) {
        console.error('Send verification code error:', err);
        Toast.error('Connection Error', 'Could not reach verification service. Please try again.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Continue / Log In';
        }
      }
    }

    async handleVerifyCode(e) {
      if (e) e.preventDefault();
      const codeInput = document.getElementById('auth-verification-code');
      const code = (codeInput?.value || '').trim();

      if (!code || code.length < 4) {
        Toast.error('Enter Code', 'Please enter the verification code sent to your email.');
        return;
      }

      const btn = document.getElementById('btn-verify-auth-code');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Verifying...';
      }

      try {
        const email = this.pendingAuthEmail || document.getElementById('auth-organizer-email')?.value.trim().toLowerCase();
        const result = await callVerificationService({
          action: 'verifyCode',
          email: email,
          code: code
        });

        if (result && result.success) {
          this.pendingAuthEmail = email;
          this.pendingUploaderId = result.uploaderId || null;
          this.clearVerificationTimer();

          // Check if profile exists in Supabase event_uploaders
          const client = this.db.getClient();
          let existingProfile = null;
          if (client) {
            const { data } = await client
              .from('event_uploaders')
              .select('id, email, full_name, phone, role_in_yuva, is_active')
              .eq('email', email)
              .maybeSingle();
            existingProfile = data;
          }

          if (existingProfile && existingProfile.is_active === true && existingProfile.full_name && existingProfile.phone && existingProfile.role_in_yuva) {
            // Approved and profile complete
            this.currentUser = {
              email: email,
              uploaderId: existingProfile.id,
              isAdmin: false,
              verified: true,
              hasCompleteProfile: true,
              fullName: existingProfile.full_name,
              phone: existingProfile.phone,
              roleInYuva: existingProfile.role_in_yuva
            };

            sessionStorage.setItem('eventUploaderEmail', email);
            sessionStorage.setItem('eventUploaderId', existingProfile.id);
            localStorage.setItem('eventUploaderEmail', email);

            this.closeModal('organizer-auth-modal');
            this.updateUploaderHeader();
            this.autoFillUploaderDetails();
            Toast.success('Authenticated', `Welcome back, ${this.currentUser.fullName}!`);

            const activeTab = document.querySelector('.saas-tab-btn.active')?.getAttribute('data-tab');
            if (activeTab === 'all-forms') this.loadAllFormsGrid();
            else if (activeTab === 'submissions') this.loadSubmissions();
          } else if (existingProfile && existingProfile.is_active === false && existingProfile.full_name) {
            // Submitted but pending Super Admin activation
            this.closeModal('organizer-auth-modal');
            this.logoutUploader(false);
            Toast.warning('Pending Approval', 'Your uploader profile is pending activation by the Super Admin.');
          } else {
            // First-time registration -> Proceed to Step 3 Profile form
            this.currentUser = {
              email: email,
              uploaderId: result.uploaderId || null,
              isAdmin: false,
              verified: true,
              hasCompleteProfile: false,
              fullName: existingProfile?.full_name || '',
              phone: existingProfile?.phone || '',
              roleInYuva: existingProfile?.role_in_yuva || ''
            };
            if (client && email) {
              client.from('event_uploaders').update({ is_active: false }).eq('email', email).then(() => {});
            }
            this.switchAuthStep('profile');
          }
        } else {
          let errorMsg = result?.error || 'Invalid verification code. Please check and try again.';
          if (result?.attemptsRemaining !== undefined) {
            errorMsg += ` (${result.attemptsRemaining} attempts remaining)`;
          }
          Toast.error('Invalid Code', errorMsg);
        }
      } catch (err) {
        console.error('Code verification error:', err);
        Toast.error('Verification Error', 'Failed to verify code. Please check your connection.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Verify &amp; Unlock';
        }
      }
    }

    async handleSaveUploaderProfile(e) {
      if (e) e.preventDefault();
      const email = this.pendingAuthEmail || this.currentUser?.email;
      if (!email) {
        this.switchAuthStep('email');
        return;
      }

      const nameInput = document.getElementById('auth-uploader-name');
      const phoneInput = document.getElementById('auth-uploader-phone');
      const roleInput = document.getElementById('auth-uploader-role');

      const name = (nameInput?.value || '').trim();
      const phone = (phoneInput?.value || '').trim();
      const role = (roleInput?.value || '').trim();

      if (!name || name.length < 2) {
        Toast.error('Name Required', 'Please enter your Legal Full Name.');
        if (nameInput) nameInput.focus();
        return;
      }

      const cleanPhone = phone.replace(/[^0-9]/g, '');
      if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 13) {
        Toast.error('Invalid Phone', 'Please enter a valid 10-digit mobile number.');
        if (phoneInput) phoneInput.focus();
        return;
      }

      if (!role || role.length < 2) {
        Toast.error('Role Required', 'Please enter your designation / role in YUVA.');
        if (roleInput) roleInput.focus();
        return;
      }

      const btn = document.getElementById('btn-save-profile');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Submitting for Approval...';
      }

      try {
        let savedSuccessfully = false;
        const client = this.db.getClient();

        // 1. Try saving directly via Supabase Client
        if (client) {
          try {
            const { error } = await client
              .from('event_uploaders')
              .upsert({
                email: email.toLowerCase(),
                full_name: name,
                phone: phone,
                role_in_yuva: role,
                verified_at: new Date().toISOString(),
                is_active: false
              }, { onConflict: 'email' });

            if (!error) savedSuccessfully = true;
          } catch (supaErr) {
            console.warn('Direct Supabase upsert error, falling back to service backend:', supaErr);
          }
        }

        // 2. Fallback to verification service (uses Service Role Key to bypass RLS)
        if (!savedSuccessfully) {
          const serviceRes = await callVerificationService({
            action: 'saveUploaderProfile',
            email: email.toLowerCase(),
            fullName: name,
            phone: phone,
            role: role
          });

          if (serviceRes && serviceRes.success) {
            savedSuccessfully = true;
          } else if (!savedSuccessfully) {
            throw new Error(serviceRes?.error || 'Database permissions error. Please run the SQL migration.');
          }
        }

        this.currentUser = { email: null, verified: false, uploaderId: null, isAdmin: false, fullName: null, phone: null, roleInYuva: null };
        this.switchAuthStep('email');
        this.closeModal('organizer-auth-modal');
        this.logoutUploader(false);
        const emailInp = document.getElementById('auth-organizer-email');
        if (emailInp) emailInp.value = email;
        Toast.success('Registration Submitted!', `Thank you, ${name}! Your profile is awaiting Super Admin activation. You can log in directly as soon as it is approved.`);

      } catch (err) {
        console.error('Error saving uploader profile:', err);
        Toast.error('Save Failed', err.message || 'Could not save profile.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-check-circle"></i> Save &amp; Activate Access';
        }
      }
    }

    cancelProfileRegistration() {
      // Incomplete profile cannot bypass -> reset and logout safely
      this.logoutUploader(false);
      this.closeModal('organizer-auth-modal');
      Toast.info('Cancelled', 'Uploader registration cancelled.');
    }

    async handleResendCode() {
      if (!this.pendingAuthEmail) {
        this.switchAuthStep('email');
        return;
      }
      const btn = document.getElementById('btn-resend-auth-code');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Resending...';
      }
      try {
        const result = await callVerificationService({
          action: 'sendVerificationCode',
          email: this.pendingAuthEmail,
          portal: 'forms',
          portalName: 'Event Registration & Forms Portal',
          portalType: 'forms_studio'
        });
        if (result && result.success) {
          Toast.success('Code Resent', `New verification code sent to ${this.pendingAuthEmail}`);
          this.startVerificationTimer(10 * 60);
        } else {
          Toast.error('Resend Failed', result?.error || 'Could not resend code.');
        }
      } catch (err) {
        Toast.error('Error', 'Unable to resend code.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-redo"></i> Resend Code';
        }
      }
    }

    startVerificationTimer(seconds = 600) {
      this.clearVerificationTimer();
      this.verificationSecondsLeft = seconds;
      const badge = document.getElementById('auth-countdown-badge');

      const updateDisplay = () => {
        const m = Math.floor(this.verificationSecondsLeft / 60);
        const s = this.verificationSecondsLeft % 60;
        const formatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        if (badge) {
          badge.textContent = `Expires in ${formatted}`;
        }
      };

      updateDisplay();
      this.verificationTimer = setInterval(() => {
        this.verificationSecondsLeft--;
        if (this.verificationSecondsLeft <= 0) {
          this.clearVerificationTimer();
          if (badge) badge.textContent = 'Code Expired';
        } else {
          updateDisplay();
        }
      }, 1000);
    }

    clearVerificationTimer() {
      if (this.verificationTimer) {
        clearInterval(this.verificationTimer);
        this.verificationTimer = null;
      }
    }

    logoutUploader(showToast = true) {
      this.currentUser = { email: null, uploaderId: null, isAdmin: false, verified: false, hasCompleteProfile: false, fullName: null, phone: null, roleInYuva: null };
      sessionStorage.removeItem('eventUploaderEmail');
      sessionStorage.removeItem('eventUploaderId');
      sessionStorage.removeItem('eventUploaderIsAdmin');
      localStorage.removeItem('eventUploaderEmail');
      localStorage.removeItem('eventUploaderId');
      this.clearVerificationTimer();
      this.updateUploaderHeader();
      this.autoFillUploaderDetails();

      // Reset Creator contact inputs
      const cEmail = document.getElementById('form-builder-creator-email');
      const cName = document.getElementById('form-builder-creator-name');
      const cPhone = document.getElementById('form-builder-creator-phone');
      if (cEmail) cEmail.value = '';
      if (cName) cName.value = '';
      if (cPhone) cPhone.value = '';

      // Reset Form Meta inputs
      const titleInput = document.getElementById('form-builder-title');
      if (titleInput) titleInput.value = '';
      const descInput = document.getElementById('form-builder-desc');
      if (descInput) descInput.value = '';
      const slugInput = document.getElementById('form-builder-slug');
      if (slugInput) slugInput.value = '';

      // Reset Event dropdown
      const eventSelect = document.getElementById('admin-event-select');
      if (eventSelect) eventSelect.value = '';
      const triggerText = document.getElementById('event-dropdown-selected-text');
      if (triggerText) triggerText.textContent = '-- Select an Event to Link (Optional) --';
      this.selectedEvent = null;
      this.updateEventStatusBadge(null);

      // Reset form schema to clean starter state
      this.formSchema = {
        id: '',
        title: '',
        description: '',
        event_id: null,
        category: 'General',
        creator_name: '',
        creator_email: '',
        creator_phone: '',
        fields: [],
        settings: {
          allowAnonymous: true,
          sendConfirmationEmail: true,
          maxSubmissions: 0,
          deadline: null,
          customTheme: 'default',
          notificationEmail: ''
        }
      };
      this.loadStarterTemplate();
      this.renderCanvas();
      this.renderLivePreview();
      this.updatePreviewHeader();
      this.updateGeneratedLinks();

      // Reset URL query parameters (e.g. ?id=...) without page reload
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }

      if (showToast) {
        Toast.info('Logged Out', 'Your session has ended.');
      }

      const activeTab = document.querySelector('.saas-tab-btn.active')?.getAttribute('data-tab');
      if (activeTab === 'all-forms') this.loadAllFormsGrid();
      else if (activeTab === 'submissions') this.loadSubmissions();
    }

    logoutOrganizer() {
      this.logoutUploader();
    }

    updateUploaderHeader() {
      const pill = document.getElementById('organizer-identity-pill');
      const authBtn = document.getElementById('btn-organizer-auth');

      if (this.currentUser && this.currentUser.verified && this.currentUser.email && this.currentUser.hasCompleteProfile) {
        if (pill) {
          pill.style.cssText = 'display:inline-flex;';
          const displayName = this.currentUser.fullName || this.currentUser.email;
          const displayRole = this.currentUser.roleInYuva || (this.currentUser.isAdmin ? 'Super Admin' : 'Event Uploader');
          const isSuperAdmin = Boolean(this.currentUser.isAdmin);

          pill.innerHTML = `
            <div class="organizer-chip-icon ${isSuperAdmin ? 'admin' : ''}" title="${isSuperAdmin ? 'Super Admin' : 'Verified Event Uploader'}">
              <i class="fas ${isSuperAdmin ? 'fa-shield-halved' : 'fa-user-check'}"></i>
            </div>
            <div class="organizer-chip-info">
              <span class="organizer-chip-name" title="${escapeHtml(displayName)} (${escapeHtml(this.currentUser.email)})">${escapeHtml(displayName)}</span>
              <span class="organizer-chip-role" title="${escapeHtml(displayRole)}">• ${escapeHtml(displayRole)}</span>
            </div>
            <button type="button" class="organizer-chip-logout" onclick="window.yuvaAdmin.logoutUploader()" title="Log out / Switch Account">
              <i class="fas fa-arrow-right-from-bracket"></i>
            </button>
          `;
        }
        if (authBtn) authBtn.style.display = 'none';
      } else {
        if (pill) {
          pill.style.display = 'none';
        }
        if (authBtn) authBtn.style.display = 'inline-flex';
      }
    }

    updateOrganizerHeader() {
      this.updateUploaderHeader();
    }

    autoFillUploaderDetails() {
      const cEmail = document.getElementById('form-builder-creator-email');
      const cName = document.getElementById('form-builder-creator-name');
      const cPhone = document.getElementById('form-builder-creator-phone');
      const lockBadge = document.getElementById('creator-identity-lock-badge');

      if (this.currentUser && this.currentUser.verified && this.currentUser.hasCompleteProfile) {
        if (cEmail) {
          cEmail.value = this.currentUser.email || '';
          cEmail.readOnly = true;
          cEmail.style.background = '#f1f5f9';
          cEmail.style.cursor = 'not-allowed';
          cEmail.style.borderColor = '#cbd5e1';
          cEmail.style.color = '#1e293b';
          cEmail.style.fontWeight = '600';
        }
        if (cName) {
          cName.value = this.currentUser.fullName || '';
          cName.readOnly = true;
          cName.style.background = '#f1f5f9';
          cName.style.cursor = 'not-allowed';
          cName.style.borderColor = '#cbd5e1';
          cName.style.color = '#1e293b';
          cName.style.fontWeight = '600';
        }
        if (cPhone) {
          cPhone.value = this.currentUser.phone || '';
          cPhone.readOnly = true;
          cPhone.style.background = '#f1f5f9';
          cPhone.style.cursor = 'not-allowed';
          cPhone.style.borderColor = '#cbd5e1';
          cPhone.style.color = '#1e293b';
          cPhone.style.fontWeight = '600';
        }
        if (lockBadge) {
          lockBadge.style.display = 'inline-flex';
        }
      } else {
        // First-time guest / not logged in / registering: All fields are fully editable!
        if (cEmail) {
          cEmail.readOnly = false;
          cEmail.style.background = '#ffffff';
          cEmail.style.cursor = 'text';
          cEmail.style.borderColor = '#e2e8f0';
          cEmail.style.color = 'inherit';
          cEmail.style.fontWeight = 'normal';
          if (!cEmail.value) cEmail.placeholder = 'e.g. organizer@yuva.org';
        }
        if (cName) {
          cName.readOnly = false;
          cName.style.background = '#ffffff';
          cName.style.cursor = 'text';
          cName.style.borderColor = '#e2e8f0';
          cName.style.color = 'inherit';
          cName.style.fontWeight = 'normal';
          if (!cName.value) cName.placeholder = 'e.g. Rahul Sharma';
        }
        if (cPhone) {
          cPhone.readOnly = false;
          cPhone.style.background = '#ffffff';
          cPhone.style.cursor = 'text';
          cPhone.style.borderColor = '#e2e8f0';
          cPhone.style.color = 'inherit';
          cPhone.style.fontWeight = 'normal';
          if (!cPhone.value) cPhone.placeholder = 'e.g. +91 98765 43210';
        }
        if (lockBadge) {
          lockBadge.style.display = 'none';
        }
      }
    }

    autoFillOrganizerDetails() {
      this.autoFillUploaderDetails();
    }

    switchTab(tabId) {
      const builderSection = document.getElementById('admin-builder-section');
      const allFormsSection = document.getElementById('admin-all-forms-section');
      const submissionsSection = document.getElementById('admin-submissions-section');

      if (builderSection) builderSection.style.display = (tabId === 'builder') ? 'block' : 'none';
      if (allFormsSection) allFormsSection.style.display = (tabId === 'all-forms') ? 'block' : 'none';
      if (submissionsSection) submissionsSection.style.display = (tabId === 'submissions') ? 'block' : 'none';

      if (tabId === 'all-forms') {
        this.loadAllFormsGrid();
      } else if (tabId === 'submissions') {
        this.loadSubmissions();
      }
    }

    matchesUploader(form) {
      if (!form) return false;
      if (this.currentUser && this.currentUser.isAdmin) return true;
      if (!this.currentUser || !this.currentUser.verified || !this.currentUser.email) return false;

      const userEmail = this.currentUser.email.toLowerCase().trim();
      const formCreatorEmail = (form.creator_email || '').toLowerCase().trim();
      const userId = this.currentUser.uploaderId;
      const formUploaderId = form.created_by_uploader;

      const emailMatch = (formCreatorEmail && formCreatorEmail === userEmail);
      const idMatch = (userId && formUploaderId && String(userId) === String(formUploaderId));

      return emailMatch || idMatch;
    }

    matchesOrganizer(form, session) {
      return this.matchesUploader(form);
    }

    async loadAllFormsGrid() {
      const lockedGate = document.getElementById('all-forms-locked-gate');
      const authorizedContent = document.getElementById('all-forms-authorized-content');
      const container = document.getElementById('forms-grid-container');
      const totalFormsEl = document.getElementById('metric-total-forms');
      const totalSubsEl = document.getElementById('metric-total-submissions');
      const totalEventsEl = document.getElementById('metric-total-events');

      if (!this.currentUser || !this.currentUser.verified || !this.currentUser.email) {
        if (lockedGate) lockedGate.style.display = 'block';
        if (authorizedContent) authorizedContent.style.display = 'none';
        return;
      }

      if (lockedGate) lockedGate.style.display = 'none';
      if (authorizedContent) authorizedContent.style.display = 'block';

      if (totalEventsEl && this.eventsList) {
        totalEventsEl.textContent = this.eventsList.length;
      }

      if (!container) return;

      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:3rem 1.5rem;">
          <div class="spinner" style="width:32px; height:32px; border-color:#e2e8f0; border-top-color:var(--saffron-primary); margin:0 auto 1rem;"></div>
          <p style="font-size:0.88rem; color:var(--text-muted);">Fetching your published forms from Supabase...</p>
        </div>
      `;

      try {
        const [allForms, allSubmissions] = await Promise.all([
          this.db.fetchAllForms(),
          this.db.fetchSubmissions()
        ]);

        // Map forms created by this uploader (or all if admin)
        const myForms = this.currentUser.isAdmin
          ? allForms
          : allForms.filter(form => this.matchesUploader(form));

        // Filter submissions belonging to my forms
        const myFormIds = new Set(myForms.map(f => f.id));
        const mySubmissions = allSubmissions.filter(s => myFormIds.has(s.form_id));

        if (totalFormsEl) totalFormsEl.textContent = myForms.length;
        if (totalSubsEl) totalSubsEl.textContent = mySubmissions.length;

        if (myForms.length === 0) {
          container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align:center; padding:3.5rem 1.5rem; background:#fff; border:2px dashed var(--border-light); border-radius:var(--radius-md);">
              <i class="fas fa-folder-open" style="font-size:2.5rem; color:var(--saffron-primary); opacity:0.6; margin-bottom:1rem;"></i>
              <h3 style="font-size:1.15rem; font-weight:800; color:var(--navy-primary); margin-bottom:0.35rem;">No Forms Found for ${escapeHtml(this.currentUser.email)}</h3>
              <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1.5rem;">You haven't created any event registration forms yet under this email.</p>
              <button class="btn btn-primary btn-sm" onclick="document.querySelector('.saas-tab-btn[data-tab=\\'builder\\']').click()">
                <i class="fas fa-plus"></i> Create Your First Form
              </button>
            </div>
          `;
          return;
        }

        container.innerHTML = myForms.map(form => {
          const fieldsCount = form.schema_json?.fields ? form.schema_json.fields.length : 0;
          const formSubsCount = allSubmissions.filter(s => s.form_id === form.id).length;
          const liveUrl = `${window.YUVA_FORMS_CONFIG.routing.productionBaseUrl}/?form_id=${form.id}`;
          const localTestUrl = `${window.YUVA_FORMS_CONFIG.routing.getBaseUrl()}/index.html?form_id=${form.id}`;
          const updatedDateStr = new Date(form.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

          let statusBadge = '';
          if (!form.is_active) {
            statusBadge = `<span class="badge" style="background:#fee2e2; color:#b91c1c; font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:4px;"><i class="fas fa-lock" style="font-size:8px;"></i> Closed</span>`;
          } else if (form.is_approved) {
            statusBadge = `<span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:4px;"><i class="fas fa-check-circle" style="font-size:8px;"></i> Live &amp; Verified</span>`;
          } else {
            statusBadge = `<span class="badge" style="background:#fef3c7; color:#b45309; font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:4px;"><i class="fas fa-clock" style="font-size:8px;"></i> Under Review</span>`;
          }

          const linkedEventTitle = form.events?.title ? `
            <div style="font-size:0.76rem; color:var(--navy-primary); background:#eff6ff; border:1px solid #bfdbfe; padding:2px 8px; border-radius:4px; margin-bottom:0.6rem; display:inline-flex; align-items:center; gap:4px; font-weight:700;">
              <i class="fas fa-calendar-alt" style="color:var(--saffron-primary);"></i> ${escapeHtml(form.events.title)}
            </div>
          ` : '';

          const displayCategory = form.category && form.category !== 'General' 
            ? form.category 
            : (form.events?.title?.toLowerCase().includes('vimarsh') ? 'Competition' : (form.category || 'Event Form'));

          return `
            <div class="form-item-card" style="position:relative; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div class="form-item-header">
                  <span class="badge" style="background:var(--navy-pale); color:var(--navy-primary); font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:4px;">${escapeHtml(displayCategory)}</span>
                  ${statusBadge}
                </div>
                ${linkedEventTitle}
                <h3 class="form-item-title" style="margin-top:0.2rem; line-height:1.35;">${escapeHtml(form.title)}</h3>
                <p class="form-item-desc" style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:0.85rem;">${escapeHtml(form.description || 'No description provided')}</p>
                <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
                  <span style="font-size:0.75rem; background:#f1f5f9; padding:2px 7px; border-radius:4px; font-weight:600; color:var(--text-secondary);"><i class="fas fa-layer-group"></i> ${fieldsCount} Fields</span>
                  <span style="font-size:0.75rem; background:var(--green-pale); color:var(--green-primary); padding:2px 7px; border-radius:4px; font-weight:700;"><i class="fas fa-user-check"></i> ${formSubsCount} Registrations</span>
                </div>
              </div>

              <div>
                <div style="display:flex; gap:6px; margin-bottom:0.75rem; flex-wrap:wrap;">
                  <button class="btn btn-primary btn-sm" style="flex:1 1 120px; justify-content:center;" onclick="window.yuvaAdmin.viewFormSubmissionsDirect('${form.id}')">
                    <i class="fas fa-users"></i> View Submissions (${formSubsCount})
                  </button>
                  <button class="btn btn-secondary btn-sm" style="flex:1 1 80px; justify-content:center;" onclick="window.yuvaAdmin.exportSingleFormCsv('${form.id}')">
                    <i class="fas fa-file-csv"></i> Export CSV
                  </button>
                </div>

                <div class="form-item-meta" style="padding-top:0.65rem;">
                  <span><i class="far fa-clock"></i> ${updatedDateStr}</span>
                  <div style="display:flex; align-items:center; gap:0.35rem;">
                    <button class="btn btn-secondary btn-sm" title="Copy Public URL" onclick="navigator.clipboard.writeText('${liveUrl}'); Toast.success('Copied', 'Public URL copied to clipboard.');">
                      <i class="fas fa-copy"></i>
                    </button>
                    <a href="${localTestUrl}" target="_blank" class="btn btn-secondary btn-sm" title="Open Form Preview">
                      <i class="fas fa-external-link-alt"></i>
                    </a>
                    <button class="btn btn-secondary btn-sm" title="Edit in Builder" onclick="window.yuvaAdmin.loadFormToEdit('${form.id}')">
                      <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" title="Delete Form" onclick="window.yuvaAdmin.deleteFormConfirm('${form.id}')">
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');

      } catch (err) {
        console.error('Failed to load forms grid:', err);
        container.innerHTML = `
          <div style="grid-column: 1 / -1; text-align:center; padding:2rem; color:var(--accent-rose);">
            <i class="fas fa-exclamation-circle"></i> Error loading forms: ${escapeHtml(err.message)}
          </div>
        `;
      }
    }

    viewFormSubmissionsDirect(formId) {
      this.activeSubmissionsFormFilter = formId;
      document.querySelector('.saas-tab-btn[data-tab="submissions"]').click();
    }

    async loadFormToEdit(formId) {
      Toast.info('Loading Form', `Loading form schema "${formId}"...`);
      await this.checkUrlForExistingFormDirect(formId);
      document.querySelector('.saas-tab-btn[data-tab="builder"]').click();
    }

    async checkUrlForExistingFormDirect(formId) {
      if (!formId) return;
      try {
        const existing = await this.db.fetchForm(formId);
        if (existing) {
          this.formSchema.id = existing.id;
          this.formSchema.title = existing.title;
          this.formSchema.description = existing.description || '';
          this.formSchema.event_id = existing.event_id;
          this.formSchema.category = existing.category || 'General';
          this.formSchema.creator_name = existing.creator_name || '';
          this.formSchema.creator_email = existing.creator_email || '';
          this.formSchema.creator_phone = existing.creator_phone || '';
          this.formSchema.created_by_uploader = existing.created_by_uploader || null;
          this.formSchema.is_approved = Boolean(existing.is_approved);
          this.formSchema.is_active = existing.is_active !== undefined ? Boolean(existing.is_active) : true;
          this.formSchema.fields = existing.schema_json?.fields || [];
          this.formSchema.settings = existing.settings || {};

          const titleInput = document.getElementById('form-builder-title');
          if (titleInput) titleInput.value = existing.title;

          const descInput = document.getElementById('form-builder-desc');
          if (descInput) descInput.value = existing.description || '';

          const slugInput = document.getElementById('form-builder-slug');
          if (slugInput) slugInput.value = existing.id;

          const cName = document.getElementById('form-builder-creator-name');
          const cEmail = document.getElementById('form-builder-creator-email');
          const cPhone = document.getElementById('form-builder-creator-phone');
          if (cName) cName.value = existing.creator_name || '';
          if (cEmail) cEmail.value = existing.creator_email || '';
          if (cPhone) cPhone.value = existing.creator_phone || '';

          if (existing.event_id) {
            await this.handleEventSelection(existing.event_id);
          } else {
            await this.handleEventSelection(null);
          }

          this.renderCanvas();
          this.renderLivePreview();
          this.updateGeneratedLinks();
          Toast.success('Form Loaded', `Editing schema for ${existing.title}`);
        }
      } catch (e) {
        console.warn('Could not load existing form:', e);
      }
    }

    async deleteFormConfirm(formId) {
      if (!confirm(`Are you sure you want to delete form "${formId}" from Supabase? This action cannot be undone.`)) {
        return;
      }

      try {
        await this.db.deleteForm(formId);
        Toast.success('Form Deleted', `Form "${formId}" has been removed from Supabase.`);
        this.loadAllFormsGrid();
      } catch (err) {
        console.error('Delete error:', err);
        Toast.error('Delete Failed', err.message || 'Could not delete form.');
      }
    }

    async loadSubmissions() {
      const lockedGate = document.getElementById('submissions-locked-gate');
      const authorizedContent = document.getElementById('submissions-authorized-content');
      const container = document.getElementById('submissions-table-body');

      if (!this.currentUser || !this.currentUser.verified || !this.currentUser.email) {
        if (lockedGate) lockedGate.style.display = 'block';
        if (authorizedContent) authorizedContent.style.display = 'none';
        return;
      }

      if (lockedGate) lockedGate.style.display = 'none';
      if (authorizedContent) authorizedContent.style.display = 'block';

      if (!container) return;

      container.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem;"><span class="spinner"></span> Loading registrations from Supabase...</td></tr>`;

      try {
        const [allForms, allSubmissions] = await Promise.all([
          this.db.fetchAllForms(),
          this.db.fetchSubmissions()
        ]);

        // 1. Get all forms created by this uploader (or all if admin)
        this.organizerForms = this.currentUser.isAdmin
          ? allForms
          : allForms.filter(form => this.matchesUploader(form));

        const myFormMap = new Map(this.organizerForms.map(f => [f.id, f]));

        // 2. Filter submissions to only those belonging to these forms
        let matchedSubs = this.currentUser.isAdmin
          ? allSubmissions
          : allSubmissions.filter(s => myFormMap.has(s.form_id));

        // Attach form object to submission for easy table rendering
        matchedSubs = matchedSubs.map(s => ({
          ...s,
          form_title: myFormMap.get(s.form_id)?.title || s.form_id
        }));

        this.allOrganizerSubmissions = matchedSubs;
        this.renderSubmissionsTable(matchedSubs);

      } catch (err) {
        console.error('Failed to load submissions:', err);
        container.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--accent-rose);">Failed to load responses: ${escapeHtml(err.message)}</td></tr>`;
      }
    }

    renderSubmissionsTable(items) {
      const container = document.getElementById('submissions-table-body');
      if (!container) return;

      if (!items || items.length === 0) {
        container.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; padding:3rem 1rem; color:var(--text-muted);">
              <i class="fas fa-inbox" style="font-size:2rem; margin-bottom:0.5rem; opacity:0.5; display:block;"></i>
              No participant responses submitted yet.
            </td>
          </tr>
        `;
        return;
      }

      container.innerHTML = items.map(sub => {
        const refId = (sub.id ? sub.id.substring(0, 8) : '------').toUpperCase();
        const dateStr = sub.created_at ? new Date(sub.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const formTitle = sub.form_title || sub.form_id || 'Registration Form';

        return `
          <tr>
            <td style="font-family:'JetBrains Mono', monospace; font-weight:700; color:#16a34a; font-size:0.85rem;">#${refId}</td>
            <td style="font-weight:700; color:var(--navy-primary); font-size:0.88rem;">${escapeHtml(formTitle)}</td>
            <td style="font-weight:700; color:#0f172a;">${escapeHtml(sub.participant_name || 'Anonymous')}</td>
            <td style="color:var(--text-secondary); font-size:0.84rem;">${escapeHtml(sub.participant_email || 'No Email')}</td>
            <td style="color:var(--text-secondary); font-size:0.84rem;">${escapeHtml(sub.participant_phone || '-')}</td>
            <td style="font-size:0.82rem; color:var(--text-muted);">${dateStr}</td>
            <td>
              <button class="btn btn-secondary btn-sm" style="padding:4px 8px; font-size:0.78rem;" onclick="window.yuvaAdmin.openSubmissionDetailModal('${sub.id}')">
                <i class="fas fa-eye"></i> Details
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    populateSubmissionsFilterDropdown(allSubmissions) {
      // Legacy wrapper
    }

    setupSubmissionsFilterDropdown() {
      // Legacy wrapper
    }

    selectSubmissionsFilterForm(formId, formTitle) {
      // Legacy wrapper
    }

    filterSubmissionsByForm(formId) {
      // Legacy wrapper
    }

    filterSubmissionsSearch(query) {
      const q = (query || '').toLowerCase().trim();
      if (!this.allOrganizerSubmissions) return;
      if (!q) {
        this.renderSubmissionsTable(this.allOrganizerSubmissions);
        return;
      }
      const filtered = this.allOrganizerSubmissions.filter(s => {
        const name = (s.participant_name || '').toLowerCase();
        const email = (s.participant_email || '').toLowerCase();
        const phone = (s.participant_phone || '').toLowerCase();
        const ref = (s.id || '').toLowerCase();
        const formT = (s.form_title || '').toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || ref.includes(q) || formT.includes(q);
      });
      this.renderSubmissionsTable(filtered);
    }

    filterAndRenderSubmissionsTable() {
      this.renderSubmissionsTable(this.allOrganizerSubmissions || []);
    }

    openSubmissionDetailModal(submissionId) {
      const sub = (this.allOrganizerSubmissions || []).find(s => String(s.id) === String(submissionId));
      if (!sub) return;

      const nameEl = document.getElementById('sub-detail-name');
      const refEl = document.getElementById('sub-detail-ref');
      const bodyEl = document.getElementById('sub-detail-body');

      if (nameEl) nameEl.textContent = sub.participant_name || 'Participant Record';
      if (refEl) refEl.textContent = `REF: ${(sub.id || '------').substring(0, 8).toUpperCase()}`;

      let responsesHtml = '';
      const responses = sub.responses_json || {};
      if (typeof responses === 'object' && Object.keys(responses).length > 0) {
        responsesHtml = Object.entries(responses).map(([k, v]) => {
          const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          const isUrl = String(valStr).startsWith('http');
          return `
            <div style="padding:10px 0; border-bottom:1px solid #f3f4f6; display:flex; justify-content:space-between; gap:12px;">
              <span style="font-weight:700; color:#1f2937; font-size:0.82rem; width:40%;">${escapeHtml(k)}</span>
              <span style="color:#4b5563; font-size:0.82rem; width:60%; text-align:right; word-break:break-word;">
                ${isUrl ? `<a href="${escapeHtml(valStr)}" target="_blank" style="color:var(--saffron-primary); font-weight:700;"><i class="fas fa-external-link-alt"></i> View File / Link</a>` : escapeHtml(valStr)}
              </span>
            </div>
          `;
        }).join('');
      } else {
        responsesHtml = '<p style="color:var(--text-muted); font-size:0.82rem;">No custom questionnaire responses recorded.</p>';
      }

      const files = sub.files_json || [];
      let filesHtml = '';
      if (files.length > 0) {
        filesHtml = `
          <div style="margin-top:16px;">
            <h4 style="font-size:0.8rem; font-weight:700; color:#1f2937; text-transform:uppercase; margin-bottom:8px;">Uploaded Attachments</h4>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${files.map(f => `
                <a href="${escapeHtml(f.url)}" target="_blank" style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; background:#fafafa; border:1px solid #e5e7eb; border-radius:6px; color:#1f2937; text-decoration:none; font-size:0.82rem; font-weight:600;">
                  <i class="fas fa-paperclip" style="color:var(--saffron-primary);"></i> ${escapeHtml(f.name || 'View Attachment')}
                </a>
              `).join('')}
            </div>
          </div>
        `;
      }

      if (bodyEl) {
        bodyEl.innerHTML = `
          <div style="background:#fffdfa; border:1px solid #fed7aa; border-radius:10px; padding:14px 16px; margin-bottom:16px;">
            <div style="font-size:1rem; font-weight:800; color:#1f2937; margin-bottom:6px;">${escapeHtml(sub.participant_name || 'Participant')}</div>
            <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:0.82rem; color:#4b5563;">
              <span><i class="fas fa-envelope" style="color:var(--saffron-primary);"></i> ${escapeHtml(sub.participant_email || 'N/A')}</span>
              <span><i class="fas fa-phone" style="color:var(--green-primary);"></i> ${escapeHtml(sub.participant_phone || 'N/A')}</span>
              <span><i class="fas fa-calendar-alt" style="color:var(--saffron-primary);"></i> ${new Date(sub.created_at).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <h4 style="font-size:0.8rem; font-weight:700; color:#1f2937; text-transform:uppercase; margin-bottom:8px;">Questionnaire Responses</h4>
          <div style="background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:4px 14px;">
            ${responsesHtml}
          </div>

          ${filesHtml}
        `;
      }

      this.openModal('submission-detail-modal');
    }

    exportSingleFormCsv(formId) {
      const subs = (this.allOrganizerSubmissions || []).filter(s => s.form_id === formId);
      this.generateAndDownloadCsv(subs, `${formId}_submissions_${Date.now()}.csv`);
    }

    exportSubmissionsCsv() {
      const subs = this.currentFilteredSubmissions || this.allOrganizerSubmissions || [];
      if (subs.length === 0) {
        Toast.error('No Data', 'There are no submissions to export.');
        return;
      }
      this.generateAndDownloadCsv(subs, `yuva_submissions_${Date.now()}.csv`);
    }

    generateAndDownloadCsv(submissions, filename) {
      if (!submissions || submissions.length === 0) {
        Toast.error('No Data', 'No submissions found to export.');
        return;
      }

      const rows = [];
      const headers = ['Ref ID', 'Submitted At', 'Form Title', 'Participant Name', 'Email Address', 'Mobile Phone', 'Responses JSON'];
      rows.push(headers.join(','));

      submissions.forEach(sub => {
        const row = [
          `"${sub.id}"`,
          `"${new Date(sub.created_at).toISOString()}"`,
          `"${escapeHtml(sub.form_title || sub.form_id || '')}"`,
          `"${escapeHtml(sub.participant_name || '')}"`,
          `"${escapeHtml(sub.participant_email || '')}"`,
          `"${escapeHtml(sub.participant_phone || '')}"`,
          `"${JSON.stringify(sub.responses_json || {}).replace(/"/g, '""')}"`
        ];
        rows.push(row.join(','));
      });

      const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', csvContent);
      downloadAnchor.setAttribute('download', filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      Toast.success('Export Ready', `Exported ${submissions.length} submission records.`);
    }

    setupSettingsModal() {
      const openBtn = document.getElementById('open-settings-modal-btn');
      const modal = document.getElementById('settings-modal');
      const saveBtn = document.getElementById('save-settings-btn');
      const resetBtn = document.getElementById('reset-settings-btn');

      if (openBtn && modal) {
        openBtn.addEventListener('click', () => {
          const creds = window.YUVA_FORMS_CONFIG.getCredentials();
          const urlInput = document.getElementById('settings-supabase-url');
          const keyInput = document.getElementById('settings-supabase-key');
          const gasInput = document.getElementById('settings-gas-url');

          if (urlInput) urlInput.value = creds.supabaseUrl || '';
          if (keyInput) keyInput.value = creds.supabaseKey || '';
          if (gasInput) gasInput.value = creds.gasUrl || '';

          this.openModal('settings-modal');
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const urlInput = document.getElementById('settings-supabase-url');
          const keyInput = document.getElementById('settings-supabase-key');
          const gasInput = document.getElementById('settings-gas-url');

          window.YUVA_FORMS_CONFIG.saveCredentials(
            urlInput ? urlInput.value : '',
            keyInput ? keyInput.value : '',
            gasInput ? gasInput.value : ''
          );

          this.db.init();
          Toast.success('Settings Saved', 'Custom credentials updated in browser.');
          this.closeModal('settings-modal');
          this.loadEventsDropdown();
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          window.YUVA_FORMS_CONFIG.resetCredentials();
          this.db.init();
          Toast.info('Defaults Restored', 'Reverted to default configuration.');
          this.closeModal('settings-modal');
          this.loadEventsDropdown();
        });
      }
    }
  }

  // ============================================================================
  // PARTICIPANT FORM RENDERER (index.html Controller)
  // ============================================================================
  class YuvaFormRenderer {
    constructor() {
      this.db = new SupabaseService();
      this.formId = null;
      this.eventId = null;
      this.formSchema = null;
      this.uploadedFiles = [];

      this.init();
    }

    async init() {
      this.parseUrlParams();
      await this.loadForm();
      this.bindSubmission();
    }

    parseUrlParams() {
      const params = new URLSearchParams(window.location.search);
      this.formId = params.get('form_id') || params.get('id');
      this.eventId = params.get('event_id');
    }

    async loadForm() {
      const wrapper = document.getElementById('rendered-form-wrapper');
      const loader = document.getElementById('form-loading-state');
      const hubState = document.getElementById('form-hub-state');
      const errorState = document.getElementById('form-error-state');
      const closedState = document.getElementById('form-closed-state');
      const underReviewState = document.getElementById('form-under-review-state');

      const hideAll = () => {
        if (loader) loader.style.display = 'none';
        if (hubState) hubState.style.display = 'none';
        if (wrapper) wrapper.style.display = 'none';
        if (errorState) errorState.style.display = 'none';
        if (closedState) closedState.style.display = 'none';
        if (underReviewState) underReviewState.style.display = 'none';
      };

      try {
        let formData = null;

        if (this.formId || this.eventId) {
          formData = await this.db.fetchForm(this.formId, this.eventId);
        } else {
          // If no query param provided, fetch all approved active forms
          const client = this.db.getClient();
          let activeForms = [];
          if (client) {
            const { data } = await client
              .from('forms')
              .select('*, events(id, title, status, start_at, end_at, location)')
              .eq('is_active', true)
              .eq('is_approved', true)
              .order('updated_at', { ascending: false });
            activeForms = data || [];
          }

          if (!activeForms || activeForms.length === 0) {
            throw new Error('There are currently no active public registration forms open at this address. Please verify your event invitation link or explore upcoming programs.');
          } else if (activeForms.length === 1) {
            // Exactly one form active -> load directly
            formData = activeForms[0];
          } else {
            // Multiple forms active -> render the Multi-Form Directory Hub!
            hideAll();
            this.renderFormHub(activeForms);
            return;
          }
        }

        if (!formData) {
          if (this.formId) {
            throw new Error(`The registration form "${this.formId}" could not be located or has concluded.`);
          } else {
            throw new Error('There are currently no active public registration forms open at this address. Please verify your event invitation link or explore upcoming programs.');
          }
        }

        // 1. Check if Form is Closed (is_active === false)
        if (formData.is_active === false) {
          hideAll();
          if (closedState) {
            closedState.style.display = 'block';
            const closedMsg = document.getElementById('form-closed-message');
            if (closedMsg) {
              closedMsg.textContent = `Registrations for "${formData.title}" have concluded or this form has been closed by the organizers. Thank you for your interest.`;
            }
          }
          return;
        }

        // 2. Check if Form is Under Review / Not Approved (is_approved !== true)
        if (formData.is_approved !== true) {
          hideAll();
          if (underReviewState) {
            underReviewState.style.display = 'block';
            const reviewMsg = document.getElementById('form-under-review-message');
            if (reviewMsg) {
              reviewMsg.textContent = `The registration form for "${formData.title}" is currently under review and is not yet active for public submissions. Please check back shortly.`;
            }
          }
          return;
        }

        // 3. Form is Live and Verified!
        this.formSchema = formData;
        this.renderFormUI(formData);
        hideAll();
        if (wrapper) wrapper.style.display = 'block';
      } catch (err) {
        console.error('[FormsEngine Frontend] Load form error:', err);
        hideAll();
        if (errorState) {
          errorState.style.display = 'block';
        }
      }
    }

    renderFormHub(forms) {
      const hubState = document.getElementById('form-hub-state');
      const hubGrid = document.getElementById('form-hub-grid');
      if (!hubState || !hubGrid) return;

      hubGrid.innerHTML = (forms || []).map(form => {
        const eventTitle = form.events?.title ? escapeHtml(form.events.title) : null;
        const formTitle = escapeHtml(form.title || 'Untitled Form');
        const formDesc = escapeHtml(form.description || 'No description provided for this registration.');
        const slug = encodeURIComponent(form.slug || form.id);
        const formUrl = `?form_id=${slug}`;
        const organizer = form.organizer_name ? escapeHtml(form.organizer_name) : 'YUVA Team';

        return `
          <div class="form-hub-card">
            <div>
              ${eventTitle ? `<div class="form-hub-card-event"><i class="fas fa-calendar-alt"></i> ${eventTitle}</div>` : ''}
              <h3 class="form-hub-card-title">${formTitle}</h3>
              <p class="form-hub-card-desc">${formDesc}</p>
            </div>
            <div>
              <div class="form-hub-card-meta">
                <span class="form-hub-card-organizer"><i class="fas fa-user-shield"></i> ${organizer}</span>
                <span style="font-size:0.72rem; color:var(--saffron-primary, #ff9933); font-weight:700;"><i class="fas fa-circle" style="font-size:0.5rem; vertical-align:middle;"></i> Active</span>
              </div>
              <a href="${formUrl}" class="saas-btn saas-btn-primary form-hub-card-action" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px;">
                <span>Register Now</span>
                <i class="fas fa-arrow-right"></i>
              </a>
            </div>
          </div>
        `;
      }).join('');

      hubState.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderFormUI(form) {
      const titleEl = document.getElementById('rendered-form-title');
      const descEl = document.getElementById('rendered-form-desc');
      const eventBadge = document.getElementById('rendered-event-badge');
      const fieldsContainer = document.getElementById('rendered-form-fields');

      if (titleEl) titleEl.textContent = form.title;
      if (descEl) descEl.textContent = form.description || '';

      if (eventBadge) {
        if (form.events && form.events.title) {
          eventBadge.innerHTML = `<i class="fas fa-calendar-alt"></i> ${escapeHtml(form.events.title)}`;
          eventBadge.style.display = 'inline-flex';
        } else {
          eventBadge.style.display = 'none';
        }
      }

      if (fieldsContainer && form.schema_json && form.schema_json.fields) {
        fieldsContainer.innerHTML = YuvaFormRenderer.generateHtmlFields(form.schema_json.fields, 'live');
        this.bindFieldInteractions();
      }
    }

    static generateHtmlFields(fields, context = 'live') {
      if (!fields || fields.length === 0) return '';

      return fields.map((field, idx) => {
        const fieldId = field.id || `field_${idx}`;
        const isRequired = field.required ? 'required' : '';
        const reqStar = field.required ? '<span style="color:var(--saffron-primary, #ff9933); margin-left:2px;">*</span>' : '';
        const placeholderText = field.placeholder ? escapeHtml(field.placeholder) : '';

        if (field.type === 'section') {
          return `
            <div style="margin: 2rem 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-glass-bright, rgba(0,0,0,0.08));">
              <h3 style="font-size:1.15rem; font-weight:700; color:var(--text-main, #0f172a); display:flex; align-items:center; gap:0.5rem;">
                <i class="fas fa-chevron-circle-right" style="color:var(--saffron-primary, #ff9933); font-size:0.9rem;"></i>
                ${escapeHtml(field.label)}
              </h3>
              ${field.helpText ? `<p style="font-size:0.82rem; color:var(--text-muted, #64748b); margin-top:0.25rem;">${escapeHtml(field.helpText)}</p>` : ''}
            </div>
          `;
        }

        if (field.type === 'textarea') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}">
              <label for="${fieldId}" class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <textarea id="${fieldId}" name="${fieldId}" class="form-field-textarea" placeholder="${placeholderText}" ${isRequired}></textarea>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
              <div class="field-error"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(field.errorMessage || 'This field is required')}</div>
            </div>
          `;
        }

        if (field.type === 'select') {
          const optionsHtml = (field.options || []).map(opt => `
            <option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>
          `).join('');

          return `
            <div class="form-field-group" data-field-id="${fieldId}">
              <label for="${fieldId}" class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <select id="${fieldId}" name="${fieldId}" class="form-field-select" ${isRequired}>
                <option value="" disabled selected>${placeholderText || 'Select an option'}</option>
                ${optionsHtml}
              </select>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
              <div class="field-error"><i class="fas fa-exclamation-triangle"></i> Please select an option</div>
            </div>
          `;
        }

        if (field.type === 'radio') {
          const choicesHtml = (field.options || []).map((opt, oIdx) => `
            <label class="custom-choice">
              <input type="radio" name="${fieldId}" value="${escapeHtml(opt)}" ${oIdx === 0 && field.required ? 'checked' : ''}>
              <span>${escapeHtml(opt)}</span>
            </label>
          `).join('');

          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div class="choice-group">${choicesHtml}</div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        if (field.type === 'checkbox') {
          const choicesHtml = (field.options || []).map(opt => `
            <label class="custom-choice">
              <input type="checkbox" name="${fieldId}" value="${escapeHtml(opt)}">
              <span>${escapeHtml(opt)}</span>
            </label>
          `).join('');

          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div class="choice-group">${choicesHtml}</div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        if (field.type === 'file') {
          const limitMB = field.maxSizeMB !== undefined && field.maxSizeMB !== null ? field.maxSizeMB : 0.5;
          const displayLimitStr = limitMB < 1 ? `${Math.round(limitMB * 1024)} KB` : `${limitMB} MB`;
          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div class="dropzone" id="dropzone-${fieldId}">
                <div class="dropzone-icon"><i class="fas fa-cloud-arrow-up"></i></div>
                <div class="dropzone-text">Click or drag & drop files here to upload</div>
                <div class="dropzone-hint">${escapeHtml(field.helpText || `Max file size: ${displayLimitStr}`)}</div>
                <input type="file" id="${fieldId}" name="${fieldId}" style="display:none;" 
                  ${field.allowedTypes && field.allowedTypes.length ? `accept="${field.allowedTypes.join(',')}"` : ''}
                  data-max-size="${limitMB}">
              </div>
              <div class="file-preview-list" id="file-preview-${fieldId}"></div>
              <div class="field-error" id="file-err-${fieldId}"><i class="fas fa-exclamation-triangle"></i> File is required</div>
            </div>
          `;
        }

        if (field.type === 'state') {
          const INDIAN_STATES = [
            'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 
            'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 
            'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 
            'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 
            'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 
            'Delhi (NCT)', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
          ];
          const stateOptionsHtml = INDIAN_STATES.map(st => `<option value="${st}">${st}</option>`).join('');

          return `
            <div class="form-field-group" data-field-id="${fieldId}">
              <label for="${fieldId}" class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <select id="${fieldId}" name="${fieldId}" class="form-field-select" ${isRequired}>
                <option value="" disabled selected>-- Select State / UT --</option>
                ${stateOptionsHtml}
              </select>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
              <div class="field-error"><i class="fas fa-exclamation-triangle"></i> Please select your state</div>
            </div>
          `;
        }

        if (field.type === 'blood_group') {
          const bgList = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
          const bgOptionsHtml = bgList.map(bg => `<option value="${bg}">${bg}</option>`).join('');

          return `
            <div class="form-field-group" data-field-id="${fieldId}">
              <label for="${fieldId}" class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <select id="${fieldId}" name="${fieldId}" class="form-field-select" ${isRequired}>
                <option value="" disabled selected>-- Select Blood Group --</option>
                ${bgOptionsHtml}
              </select>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
              <div class="field-error"><i class="fas fa-exclamation-triangle"></i> Please select your blood group</div>
            </div>
          `;
        }

        if (field.type === 'tshirt') {
          const sizes = (field.options && field.options.length) ? field.options : ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
          const sizeChoicesHtml = sizes.map((sz, sIdx) => `
            <label class="custom-choice" style="display:inline-flex; margin-right:0.5rem; margin-bottom:0.5rem;">
              <input type="radio" name="${fieldId}" value="${escapeHtml(sz)}" ${sIdx === 2 && field.required ? 'checked' : ''}>
              <span style="font-weight:700; padding:0.4rem 0.85rem;">${escapeHtml(sz)}</span>
            </label>
          `).join('');

          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div class="choice-group" style="display:flex; flex-wrap:wrap; gap:0.4rem;">${sizeChoicesHtml}</div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        if (field.type === 'rating') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div class="rating-stars-group" style="display:flex; gap:0.5rem; font-size:1.5rem; color:#cbd5e1; cursor:pointer;">
                ${[1, 2, 3, 4, 5].map(star => `
                  <label style="cursor:pointer; transition:color 0.2s ease;">
                    <input type="radio" name="${fieldId}" value="${star}" style="display:none;">
                    <i class="fas fa-star" style="color: #f59e0b;"></i>
                  </label>
                `).join('')}
              </div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        if (field.type === 'scale') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin:0.5rem 0;">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => `
                  <label class="custom-choice" style="margin:0;">
                    <input type="radio" name="${fieldId}" value="${num}">
                    <span style="padding:0.45rem 0.75rem; font-weight:700; font-size:0.85rem;">${num}</span>
                  </label>
                `).join('')}
              </div>
              <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted);">
                <span>1 - Not Likely</span>
                <span>10 - Extremely Likely</span>
              </div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        if (field.type === 'boolean') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div style="display:flex; gap:0.75rem; margin-top:0.35rem;">
                <label class="custom-choice">
                  <input type="radio" name="${fieldId}" value="Yes" checked>
                  <span><i class="fas fa-check" style="color:#10b981; margin-right:4px;"></i> Yes</span>
                </label>
                <label class="custom-choice">
                  <input type="radio" name="${fieldId}" value="No">
                  <span><i class="fas fa-times" style="color:#ef4444; margin-right:4px;"></i> No</span>
                </label>
              </div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        if (field.type === 'consent') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:0.85rem 1rem;">
              <label class="custom-choice" style="align-items:flex-start;">
                <input type="checkbox" name="${fieldId}" value="Agreed" ${isRequired}>
                <span style="font-size:0.85rem; line-height:1.45; font-weight:600; color:var(--text-primary);">
                  <i class="fas fa-shield-alt" style="color:var(--saffron-primary); margin-right:4px;"></i>
                  ${escapeHtml(field.label)} ${reqStar}
                </span>
              </label>
              ${field.helpText ? `<div class="field-help" style="margin-left:1.8rem;"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
              <div class="field-error"><i class="fas fa-exclamation-triangle"></i> You must agree before submitting</div>
            </div>
          `;
        }

        if (field.type === 'currency') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}">
              <label for="${fieldId}" class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div style="position:relative; display:flex; align-items:center;">
                <span style="position:absolute; left:14px; font-weight:700; color:var(--text-muted); font-size:1rem;">₹</span>
                <input type="number" min="0" step="1" id="${fieldId}" name="${fieldId}" class="form-field-input" 
                  style="padding-left:32px;" placeholder="${placeholderText || '0.00'}" ${isRequired}>
              </div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
              <div class="field-error"><i class="fas fa-exclamation-triangle"></i> Please enter a valid amount</div>
            </div>
          `;
        }

        if (field.type === 'signature') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div style="background:#ffffff; border:1px dashed #cbd5e1; border-radius:10px; padding:1.25rem; text-align:center;">
                <input type="text" id="${fieldId}" name="${fieldId}" class="form-field-input" 
                  style="font-family:'Courier New', Courier, monospace; font-size:1.1rem; font-weight:700; text-align:center; background:#f8fafc;" 
                  placeholder="Type your full legal name to digitally sign" ${isRequired}>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.4rem;">
                  <i class="fas fa-lock" style="color:var(--saffron-primary);"></i> Legally binding digital timestamp & IP will be recorded upon submission
                </div>
              </div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        if (field.type === 'address') {
          return `
            <div class="form-field-group" data-field-id="${fieldId}" style="margin-bottom:1.5rem;">
              <label class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
              <div style="display:grid; grid-template-columns:1fr; gap:0.5rem;">
                <input type="text" name="${fieldId}_street" class="form-field-input" placeholder="Flat, House no., Building, Company, Apartment" ${isRequired}>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
                  <input type="text" name="${fieldId}_city" class="form-field-input" placeholder="City / District" ${isRequired}>
                  <input type="text" name="${fieldId}_pincode" class="form-field-input" placeholder="PIN Code (6-digit)" ${isRequired} data-regex="^[1-9][0-9]{5}$">
                </div>
              </div>
              ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            </div>
          `;
        }

        // Standard Text, Email, Phone, Number, Date, Time, DateTime, URL, etc.
        const inputType = field.type === 'phone' ? 'tel' : 
                          field.type === 'time' ? 'time' : 
                          field.type === 'datetime' ? 'datetime-local' : 
                          field.type === 'url' || field.type === 'linkedin' ? 'url' : 
                          (field.type || 'text');
        const patternAttr = field.validationRegex ? `data-regex="${escapeHtml(field.validationRegex)}" data-error-msg="${escapeHtml(field.errorMessage || '')}"` : '';

        return `
          <div class="form-field-group" data-field-id="${fieldId}">
            <label for="${fieldId}" class="form-field-label">${escapeHtml(field.label)} ${reqStar}</label>
            <input type="${inputType}" id="${fieldId}" name="${fieldId}" class="form-field-input" 
              placeholder="${placeholderText}" ${isRequired} ${patternAttr}>
            ${field.helpText ? `<div class="field-help"><i class="fas fa-info-circle"></i> ${escapeHtml(field.helpText)}</div>` : ''}
            <div class="field-error"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(field.errorMessage || 'Please enter a valid value')}</div>
          </div>
        `;
      }).join('');
    }

    bindFieldInteractions() {
      // Setup file upload dropzones
      document.querySelectorAll('.dropzone').forEach(dz => {
        const input = dz.querySelector('input[type="file"]');
        if (!input) return;

        dz.addEventListener('click', () => input.click());

        ['dragenter', 'dragover'].forEach(eventName => {
          dz.addEventListener(eventName, (e) => {
            e.preventDefault();
            dz.classList.add('dragover');
          });
        });

        ['dragleave', 'drop'].forEach(eventName => {
          dz.addEventListener(eventName, (e) => {
            e.preventDefault();
            dz.classList.remove('dragover');
          });
        });

        dz.addEventListener('drop', (e) => {
          if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            this.handleFileSelected(input);
          }
        });

        input.addEventListener('change', () => this.handleFileSelected(input));
      });

      // Realtime validation feedback
      document.querySelectorAll('.form-field-input, .form-field-textarea, .form-field-select, .floating-input, .floating-textarea, .floating-select').forEach(input => {
        input.addEventListener('blur', () => this.validateSingleInput(input));
        input.addEventListener('input', () => {
          this.validateSingleInput(input);
        });
      });
    }

    handleFileSelected(fileInput) {
      const file = fileInput.files[0];
      const previewList = document.getElementById(`file-preview-${fileInput.id}`);
      const errBox = document.getElementById(`file-err-${fileInput.id}`);

      if (!file || !previewList) return;

      const maxSizeMB = parseFloat(fileInput.dataset.maxSize || 0.5);
      const displayLimitStr = maxSizeMB < 1 ? `${Math.round(maxSizeMB * 1024)} KB` : `${maxSizeMB} MB`;
      if (file.size > maxSizeMB * 1024 * 1024) {
        if (errBox) {
          errBox.textContent = `File exceeds max size limit of ${displayLimitStr}`;
          errBox.style.display = 'flex';
        }
        fileInput.value = '';
        return;
      }

      if (errBox) errBox.style.display = 'none';

      previewList.innerHTML = `
        <div class="file-preview-item">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <i class="fas fa-paperclip" style="color:var(--brand-saffron, #ff9933);"></i>
            <span>${escapeHtml(file.name)}</span>
            <span style="color:var(--text-dim, #94a3b8); font-size:0.75rem;">(${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
          </div>
          <button type="button" class="btn-icon btn-danger btn-sm" style="border:none; cursor:pointer;" onclick="const inp = document.getElementById('${fileInput.id}'); if (inp) inp.value = ''; this.closest('.file-preview-item').remove();">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
    }

    validateSingleInput(input) {
      const group = input.closest('.form-field-group, .floating-group');
      if (!group) return true;

      const val = input.value.trim();
      const isRequired = input.hasAttribute('required');
      const regexPattern = input.getAttribute('data-regex');
      const errEl = group.querySelector('.field-error');

      if (isRequired && !val) {
        group.classList.add('has-error');
        if (errEl) {
          errEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> This field is required';
        }
        return false;
      }

      if (regexPattern && val) {
        try {
          const rx = new RegExp(regexPattern);
          if (!rx.test(val)) {
            group.classList.add('has-error');
            const customMsg = input.getAttribute('data-error-msg');
            if (errEl) {
              errEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${escapeHtml(customMsg || 'Please enter a valid value')}`;
            }
            return false;
          }
        } catch (e) {
          console.warn('Regex eval error:', e);
        }
      }

      group.classList.remove('has-error');
      return true;
    }

    bindSubmission() {
      const formEl = document.getElementById('yuva-live-form');
      if (!formEl) return;

      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleFormSubmit();
      });
    }

    async handleFormSubmit() {
      const formEl = document.getElementById('yuva-live-form');
      const submitBtn = document.getElementById('yuva-submit-btn');
      if (!formEl || !this.formSchema) return;

      // 1. Validate all inputs
      let isValid = true;
      const allInputs = formEl.querySelectorAll('.form-field-input, .form-field-textarea, .form-field-select, .floating-input, .floating-textarea, .floating-select');
      allInputs.forEach(input => {
        if (!this.validateSingleInput(input)) isValid = false;
      });

      if (!isValid) {
        Toast.error('Incomplete Details', 'Please correct the highlighted fields before submitting.');
        return;
      }

      // 2. Gather field values
      const responses = {};
      let participantName = '';
      let participantEmail = '';
      let participantPhone = '';

      const fields = this.formSchema.schema_json?.fields || [];
      const fileUploadTasks = [];

      fields.forEach(field => {
        const fieldId = field.id;
        if (field.type === 'section') return;

        if (field.type === 'checkbox') {
          const checkedValues = [];
          formEl.querySelectorAll(`input[name="${fieldId}"]:checked`).forEach(chk => checkedValues.push(chk.value));
          responses[field.label || fieldId] = checkedValues;
        } else if (field.type === 'radio') {
          const checked = formEl.querySelector(`input[name="${fieldId}"]:checked`);
          responses[field.label || fieldId] = checked ? checked.value : '';
        } else if (field.type === 'file') {
          const fileInput = document.getElementById(fieldId);
          if (fileInput && fileInput.files.length > 0) {
            fileUploadTasks.push({ fieldKey: field.label || fieldId, file: fileInput.files[0] });
          }
        } else {
          const input = document.getElementById(fieldId);
          const val = input ? input.value.trim() : '';
          responses[field.label || fieldId] = val;

          // Detect common identity keys — check field.type FIRST, then label fallback
          const normKey = (field.label || fieldId).toLowerCase();
          if ((field.type === 'name' || normKey.includes('name')) && !participantName) participantName = val;
          if ((field.type === 'email' || normKey.includes('email') || normKey.includes('mail')) && !participantEmail) participantEmail = val;
          if ((field.type === 'phone' || field.type === 'tel' || normKey.includes('phone') || normKey.includes('mobile') || normKey.includes('whatsapp')) && !participantPhone) participantPhone = val;
        }
      });

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Processing Submission...';
      }

      try {
        // 3. Upload attached files to Supabase Storage organized by formId & attendeeId
        const attendeeToken = participantPhone 
          ? `att_${participantPhone.replace(/[^0-9]/g, '')}` 
          : (participantEmail ? `att_${participantEmail.replace(/[^a-zA-Z0-9]/g, '_')}` : `att_${Date.now()}`);

        const uploadedFilesData = [];
        for (const task of fileUploadTasks) {
          try {
            const uploaded = await this.db.uploadFile(task.file, this.formSchema.id, attendeeToken);
            uploadedFilesData.push({
              field: task.fieldKey,
              ...uploaded
            });
            responses[task.fieldKey] = uploaded.url;
          } catch (fileErr) {
            console.warn(`File upload skipped or storage bucket unconfigured:`, fileErr);
            responses[task.fieldKey] = `[Uploaded File: ${task.file.name}]`;
          }
        }

        // 4. Save to Supabase DB form_submissions table via Google Apps Script bridge
        const submissionPayload = {
          form_id: this.formSchema.id,
          event_id: this.formSchema.event_id || null,
          form_title: this.formSchema.title,
          event_title: this.formSchema.events?.title || this.formSchema.title,
          event_date: this.formSchema.events?.start_at ? new Date(this.formSchema.events.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
          event_location: this.formSchema.events?.location || '',
          confirmation_message: this.formSchema.settings?.confirmationMessage || '',
          participant_name: participantName || 'Participant',
          participant_email: participantEmail || '',   // Empty string (not null) so Code.gs email check works
          participant_phone: participantPhone || '',
          responses_json: responses,
          files_json: uploadedFilesData
        };

        // DEBUG — remove after confirming email works
        console.log('[DEBUG] Submission identity detected:', {
          participant_name: submissionPayload.participant_name,
          participant_email: submissionPayload.participant_email,
          participant_phone: submissionPayload.participant_phone
        });

        const savedRecord = await this.db.submitResponse(submissionPayload);
        const refCode = (savedRecord.id ? String(savedRecord.id).substring(0, 8) : Math.random().toString(36).substring(2, 10)).toUpperCase();

        // 5. Show clean Confirmation Card (or Already Registered card)
        this.displaySuccessState(savedRecord, refCode, savedRecord.duplicate || false);

      } catch (err) {
        console.error('Submission failed:', err);
        Toast.error('Submission Error', err.message || 'Could not record submission. Please check connection.');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Registration';
        }
      }
    }

    displaySuccessState(record, refCode, isDuplicate = false) {
      const wrapper = document.getElementById('rendered-form-wrapper');
      const successState = document.getElementById('form-success-state');
      const refCodeEl = document.getElementById('success-ref-code');
      const msgEl = document.getElementById('success-custom-message');

      if (wrapper) wrapper.style.display = 'none';
      if (refCodeEl) refCodeEl.textContent = refCode;

      if (isDuplicate) {
        // Already registered — show warm amber message with original ref
        const heading = successState?.querySelector('h2');
        if (heading) {
          heading.textContent = 'Already Registered!';
          heading.style.color = 'var(--saffron-primary, #FF9933)';
        }
        if (msgEl) {
          msgEl.textContent = 'You are already registered for this event. Your original confirmation has been resent to your email.';
        }
        Toast.warning('Already Registered', 'Your original confirmation has been resent to your email.');
      } else if (msgEl && this.formSchema.settings?.confirmationMessage) {
        msgEl.textContent = this.formSchema.settings.confirmationMessage;
      }

      if (successState) {
        successState.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      Toast.success('Registration Complete!', 'Confirmation email sent to your inbox.');
    }
  }

  // Export globally to window
  window.Toast = Toast;
  window.SupabaseService = SupabaseService;
  window.GASService = GASService;
  window.AdminFormBuilder = AdminFormBuilder;
  window.YuvaFormRenderer = YuvaFormRenderer;

})();
