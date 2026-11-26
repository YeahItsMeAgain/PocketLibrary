import React from 'react';
import { createRoot } from 'react-dom/client';
import { Book3DCanvas } from 'book-3d';

const params = new URLSearchParams(location.search);
const cover = params.get('cover') || 'whisper-man';
const pageCount = Number(params.get('pages') || 12);

const urls = {
  'whisper-man': '/covers/whisper-man-cover.jpg',
  'rock-paper-scissors': '/covers/rock-paper-scissors-cover.jpg',
  'moby-dick': '/covers/moby-dick.jpg',
};

// A sheet has a front and back image. Reuse the cover as a stand-in page so we
// can test how the geometry's spine thickness responds to page count.
const pages = Array.from({ length: pageCount }, (_, i) => ({
  front: urls[cover],
  back: urls[cover],
}));

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#e9e4da', position: 'relative' }}>
      <Book3DCanvas
        width={2.4}
        height={3.6}
        coverColor="#14342b"
        pages={pages}
        currentPage={0}
        cameraDistance={6.5}
      />
      <div style={{
        position: 'absolute', left: 20, bottom: 18, right: 20, fontFamily: 'system-ui, sans-serif',
        fontSize: 13, color: '#333', background: 'rgba(255,255,255,.82)', padding: '8px 10px', borderRadius: 6,
      }}>
        book-3d (Three.js / R3F) · cover={cover} · sheets={pageCount} · coverColor=#14342b.
        Thickness is derived from sheet count, but the spine is a plain coloured casing — no spine texture or text controls.
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
