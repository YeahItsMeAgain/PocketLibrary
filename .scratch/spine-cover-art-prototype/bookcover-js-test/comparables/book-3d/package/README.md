<div align="center">

# 📖 book-3d

### *The interactive, page-flipping 3D book component your portfolio has been waiting for.*

Bring tactile, real-world book physics into your React & Three.js apps. Zero flat boring sliders, zero clunky PDFs. Just smooth page bends, authentic curling physics, and satisfying leaf flips.

[![npm version](https://img.shields.io/npm/v/book-3d.svg?style=flat-square&color=38BDF8)](https://www.npmjs.com/package/book-3d)
[![License: MIT](https://img.shields.io/badge/License-MIT-FACC15.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Three.js](https://img.shields.io/badge/Three.js-r150+-E11D48.svg?style=flat-square)](https://threejs.org/)
[![React](https://img.shields.io/badge/React-18+-10B981.svg?style=flat-square)](https://react.dev/)

[Quick Start](#-quick-start) • [Why You'll Love It](#-why-another-book-component) • [Props](#-props-cheat-sheet) • [How Page Pairing Works](#-how-page-pairing-works)

</div>

---

## 🧐 Why another book component?

Most "flipbooks" on the web are either flat 2D CSS hacks pretending to be 3D, or heavy PDF viewers that feel like 2008.

**book-3d** is built from the ground up for modern Three.js developers using `@react-three/fiber`:

- 🍃 **Real Paper Curling:** Each page isn't a rigid wooden plank — vertices dynamically bend and curl along physical trigonometric curves as you flip.
- 🧱 **Cascading Anti-Clip Physics:** Ever had pages slice right through each other in 3D? We wrote cascading elevation stacking laws so sheets respect the natural stack order.
- 📐 **Any Aspect Ratio You Want:** Wide comic book? Tall fantasy novel? Pocket diary? Square lookbook? Just pass your own `width` and `height`.
- 🪡 **Delicious Details:** Stitched binding gutter, realistic metallic saddle staples, and a leather-wrapped spine that naturally sizes itself to your exact page count.
- 🎨 **Image URLs, Canvas, or Textures:** Feed it standard image URLs (`.jpg`, `.png`, `.webp`), HTML5 canvases, or native `THREE.Texture` instances.

---

## ⚡ Installation

Install `book-3d` along with its peer dependencies:

```bash
npm install book-3d three @react-three/fiber @react-three/drei
```

Using Yarn, PNPM, or Bun?
```bash
# pnpm
pnpm add book-3d three @react-three/fiber @react-three/drei

# bun
bun add book-3d three @react-three/fiber @react-three/drei
```

---

## 🚀 Quick Start

### 1. The "Just give me a working book right now" way (`<Book3DCanvas />`)

Don't have a Three.js setup yet? No problem. Drop in `<Book3DCanvas />` and you get full lighting, shadows, responsive camera, and mouse orbit controls out of the box:

```tsx
import React, { useState } from 'react';
import { Book3DCanvas } from 'book-3d';

export default function BookShowcase() {
  const [currentPage, setCurrentPage] = useState(0);

  // Each item represents one physical sheet of paper (2 sides)
  const myPages = [
    {
      front: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=1000', // Front Cover
      back: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=1000',  // Inside Cover / Page 1
    },
    {
      front: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=1000', // Page 2
      back: 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=1000',  // Page 3
    },
    {
      front: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=1000', // Page 4
      back: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=1000',  // Back Cover
    },
  ];

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0F172A' }}>
      <Book3DCanvas
        width={2.4}
        height={3.4}
        coverColor="#1E1B4B"
        pages={myPages}
        currentPage={currentPage}
        onPageClick={(targetSpread) => setCurrentPage(targetSpread)}
      />

      {/* Floating navigation controls */}
      <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 12 }}>
        <button onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}>👈 Prev</button>
        <button onClick={() => setCurrentPage((p) => Math.min(myPages.length, p + 1))}>Next 👉</button>
      </div>
    </div>
  );
}
```

---

### 2. The "I'm a 3D wizard with my own Scene" way (`<Book3D />`)

Already running a 3D desk scene, studio lighting, or room model with `@react-three/fiber`? Put `<Book3D />` directly inside your existing `<Canvas>`:

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Book3D } from 'book-3d';

export function DeskRoom() {
  return (
    <Canvas shadows camera={{ position: [0, 4, 6], fov: 35 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 5]} castShadow />
      <OrbitControls />

      {/* Place your 3D desk / room models here */}
      
      {/* Your 3D Book on the desk */}
      <Book3D
        width={2.5}
        height={3.5}
        coverColor="#3B0764"
        currentPage={1}
        pages={[
          { front: '/art/cover.png', back: '/art/page1.png' },
          { front: '/art/page2.png', back: '/art/page3.png' },
          { front: '/art/page4.png', back: '/art/backcover.png' },
        ]}
        onPageClick={(nextPage) => console.log('Flip to:', nextPage)}
      />
    </Canvas>
  );
}
```

---

## 🎛️ Props Cheat Sheet

### `<Book3D />`

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `pages` | `BookPage[]` | *required* | Array of `{ front, back }` image URLs, Canvases, or Three.js textures. |
| `width` | `number` | `2.4` | Width of a single page in 3D units. |
| `height` | `number` | `3.4` | Height of the book in 3D units. |
| `currentPage` | `number` | `0` | Active spread (`0` = front cover closed, `pages.length` = back cover closed). |
| `onPageClick` | `(page: number) => void` | `undefined` | Callback when a user clicks any page to turn forward or backward. |
| `coverColor` | `string` | `"#0A0E17"` | Spine casing and hardcover accent color. |
| `roughness` | `number` | `0.5` | Spine material roughness (0.0 = glossy, 1.0 = matte). |
| `metalness` | `number` | `0.05` | Spine material metalness. |
| `segmentsX` | `number` | `50` | Horizontal mesh divisions (higher = silky smooth page bends). |
| `segmentsY` | `number` | `20` | Vertical mesh divisions. |
| `showBindingStaples`| `boolean` | `true` | Show realistic center gutter staples when the book is open. |
| `hardCover` | `boolean` | `true` | Makes the front and back cover behave with rigid hardcover stiffness. |
| `position` | `[x, y, z]` | `[0, 0, 0]` | 3D coordinate offset. |
| `rotation` | `[x, y, z]` | `[0, 0, 0]` | 3D Euler rotation. |
| `scale` | `number \| [x, y, z]`| `1` | Global scale multiplier. |

### `<Book3DCanvas />` (Canvas Wrapper)

Takes everything from `<Book3D />`, plus:

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `className` | `string` | `undefined` | CSS class name for the wrapper `<div>`. |
| `style` | `CSSProperties` | `undefined` | Inline styles for the wrapper container. |
| `enableControls` | `boolean` | `true` | Enables smooth mouse OrbitControls (drag to rotate, wheel to zoom). |
| `cameraDistance` | `number` | `5.5` | Initial camera Z distance from the book. |

---

## 💡 How Page Pairing Works

Just like a real paper book, each sheet of paper has two printable sides:
```
Sheet 0:  [Front: Front Cover]              [Back: Inside Page 1]
Sheet 1:  [Front: Inside Page 2]             [Back: Inside Page 3]
Sheet 2:  [Front: Inside Page 4]             [Back: Back Cover]
```

- When the book is **closed (Spread 0)**: You see `pages[0].front` (Front Cover).
- When you flip to **Spread 1**: Sheet 0 turns over, revealing `pages[0].back` on the left and `pages[1].front` on the right!
- When you flip all the way to **the end**: You see `pages[last].back` (Back Cover).

---

## 🤝 Contributing & Feedback

Have ideas for bookmark ribbons, audio flip sound effects, or custom shaders? Pull requests and suggestions are always welcome!

---

## 📜 License

MIT © Built with passion for the developer community.
