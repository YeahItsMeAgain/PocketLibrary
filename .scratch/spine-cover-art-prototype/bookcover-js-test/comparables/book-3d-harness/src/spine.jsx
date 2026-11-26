import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Book3D } from 'book-3d';

const params = new URLSearchParams(location.search);
const sheets = Number(params.get('pages') || 40);
const cover = params.get('cover') || '/covers/whisper-man-cover.jpg';

const pages = Array.from({ length: sheets }, () => ({ front: cover, back: cover }));

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#e9e4da', position: 'relative' }}>
      <Canvas shadows camera={{ position: [-4.6, 0.3, 0.2], fov: 32 }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[4, 6, 4]} intensity={1.8} castShadow />
        <directionalLight position={[-4, 2, -3]} intensity={0.8} />
        <Book3D width={2.4} height={3.6} coverColor="#14342b" pages={pages} currentPage={0} />
        <OrbitControls />
      </Canvas>
      <div style={{
        position: 'absolute', left: 20, bottom: 18, right: 20, fontFamily: 'system-ui, sans-serif',
        fontSize: 13, color: '#333', background: 'rgba(255,255,255,.82)', padding: '8px 10px', borderRadius: 6,
      }}>
        Spine close-up, camera on −X · book-3d with {sheets} sheets. The spine is a <code>boxGeometry</code> with a single
        <code>meshStandardMaterial color=#14342b</code>: no texture map, no title/author, no per-book artwork.
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
