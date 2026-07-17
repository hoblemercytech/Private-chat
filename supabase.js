
const SUPABASE_URL = "https://qfrophntpaomvnugzhid.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcm9waG50cGFvbXZudWd6aGlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MTIyMzQsImV4cCI6MjA5ODE4ODIzNH0.DVRMqmJ8k468c6ulc3jztpn92zFpeg7F5BYurcPwt_4";


function buildSupabaseClient() {
  
  const guestId = localStorage.getItem("chatapp_guest_id") || "";
  
  return window.supabase.createClient(
    
    SUPABASE_URL,
    
    SUPABASE_ANON_KEY,
    
    {
      
      global: {
        
        headers: {
          
          "x-guest-id": guestId
          
        }
        
      },
      
      realtime: {
        
        params: {
          
          eventsPerSecond: 10
          
        }
        
      }
      
    }
    
  );
  
}

// Make the client globally available immediately

window.db = buildSupabaseClient();

function refreshSupabaseClient() {
  
  window.db = buildSupabaseClient();
  
  return window.db;
  
}

// Optional: expose the refresh function globally

window.refreshSupabaseClient = refreshSupabaseClient;