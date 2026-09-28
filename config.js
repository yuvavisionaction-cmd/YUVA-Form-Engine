/**
 * YUVA Bharat Forms Engine - Central Configuration
 * Isolated module for standalone deployment on forms.yuva.ind.in
 */

const YUVA_FORMS_CONFIG = {
  // Default Supabase Credentials (matches YUVA Bharat production backend)
  supabase: {
    url: 'https://jgsrsjwmywiirtibofth.supabase.co',
    anonKey: 'sb_publishable_5KtvO0cEHfnECBoyp2CQnw_RC3_x2me',
    storageBucket: 'event-banners', // Using existing YUVA event storage bucket
  },

  // Google Apps Script Web App Endpoint for Webhook & Automation
  gas: {
    webhookUrl: 'https://script.google.com/macros/s/AKfycbwbRi0v7O6tUex6VfR0zxMLGgE1buL_Lm9V2_eqJPUEkjxTR2nnGcg9EYijELubrTeM/exec',
    enabled: true,
  },

  // Host & Routing Configuration
  routing: {
    productionBaseUrl: 'https://forms.yuva.ind.in',
    mainWebsiteUrl: 'https://yuva.ind.in',
    upcomingEventsUrl: 'https://yuva.ind.in/Events/Upcoming.html',
    homeUrl: 'https://yuva.ind.in/home.html',
    contactUrl: 'https://yuva.ind.in/About/ContactUs.html',
    // Dynamic fallback for localhost / development
    getBaseUrl: () => {
      if (typeof window !== 'undefined' && window.location) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          return `${window.location.origin}${window.location.pathname.replace(/\/(admin|index)\.html.*$/, '')}`;
        }
      }
      return 'https://forms.yuva.ind.in';
    }
  },

  // Brand Metadata
  branding: {
    name: 'YUVA Bharat Forms Engine',
    shortName: 'YUVA Forms',
    tagline: 'Youth Vision Action • Unified Registration Platform',
    logoUrl: 'https://yuva.ind.in/Images/YUVA%20logo.png',
    supportEmail: 'admin@yuva.ind.in',
    primaryColor: '#ff6f00', // YUVA Saffron
    accentColor: '#6366f1',  // Electric Indigo
  },

  // Helper to load customized credentials stored by admin in localStorage
  getCredentials: () => {
    try {
      const customUrl = localStorage.getItem('yuva_forms_supabase_url');
      const customKey = localStorage.getItem('yuva_forms_supabase_key');
      const customGas = localStorage.getItem('yuva_forms_gas_url');
      return {
        supabaseUrl: customUrl || YUVA_FORMS_CONFIG.supabase.url,
        supabaseKey: customKey || YUVA_FORMS_CONFIG.supabase.anonKey,
        gasUrl: customGas || YUVA_FORMS_CONFIG.gas.webhookUrl,
        storageBucket: YUVA_FORMS_CONFIG.supabase.storageBucket,
      };
    } catch (e) {
      return {
        supabaseUrl: YUVA_FORMS_CONFIG.supabase.url,
        supabaseKey: YUVA_FORMS_CONFIG.supabase.anonKey,
        gasUrl: YUVA_FORMS_CONFIG.gas.webhookUrl,
        storageBucket: YUVA_FORMS_CONFIG.supabase.storageBucket,
      };
    }
  },

  // Helper to persist custom credentials
  saveCredentials: (url, key, gasUrl) => {
    try {
      if (url) localStorage.setItem('yuva_forms_supabase_url', url.trim());
      if (key) localStorage.setItem('yuva_forms_supabase_key', key.trim());
      if (gasUrl) localStorage.setItem('yuva_forms_gas_url', gasUrl.trim());
      return true;
    } catch (e) {
      console.error('Failed to save credentials:', e);
      return false;
    }
  },

  resetCredentials: () => {
    try {
      localStorage.removeItem('yuva_forms_supabase_url');
      localStorage.removeItem('yuva_forms_supabase_key');
      localStorage.removeItem('yuva_forms_gas_url');
    } catch (e) { }
  }
};

// Export globally for browser scripts
if (typeof window !== 'undefined') {
  window.YUVA_FORMS_CONFIG = YUVA_FORMS_CONFIG;
}
