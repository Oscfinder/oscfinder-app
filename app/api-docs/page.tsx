'use client';
import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';

// swagger-ui-react touches the DOM at import time -- must be client-only, no SSR.
const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false });

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="px-6 py-4 bg-[#0A1628]">
        <h1 className="text-[17px] font-bold leading-tight">
          <span className="text-[#0099CC]">Os</span>
          <span className="text-white">C</span>
          <span className="text-[#00C48C]">Finder</span>
          <span className="text-white/60 font-medium"> — API Docs</span>
        </h1>
      </div>
      <SwaggerUI
        url="/swagger.json"
        // "Try it out" calls are same-origin, so including the browser's existing
        // Supabase session cookies is enough to test endpoints as whoever is
        // currently logged in -- no separate API key/token entry needed. Logged-out
        // visitors can still browse the docs; live calls will just 401 like normal.
        requestInterceptor={(req: any) => {
          req.credentials = 'include';
          return req;
        }}
      />
    </div>
  );
}
