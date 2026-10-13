Primary Brand Colors
Dark Blue Background: #050C26
This is the deep navy blue used for the main section of the webpage.
Bright Orange: #F26522
This vibrant orange is used in the Atgeir Solutions logo (the upward arrow and bar chart) and the newsletter button.
Secondary Colors
White: #FFFFFF
Used for the main "ATGEIR SOLUTIONS" text and the body copy.
LinkedIn Blue: #0077B5
The standard brand color for the LinkedIn social icon shown.
Light Gray: #D1D3D4
Used for the input field background 
To create a professional and "decent" UI, you need a balanced palette that includes neutral weights for backgrounds, vibrant accents for calls-to-action (CTAs), and subtle tones for borders and secondary text.
 base colors, organized by their role in UI design:
1. The Deep Navy Palette (Base & Backgrounds)
Use the darker shades for main backgrounds and the lighter "Tint" for cards or elevated surfaces to create depth.
Usage	Color Name	Hex Code
Primary Base	Atgeir Navy	#050C26
Deepest Shadow	Midnight	#02050F
Elevated Surface	Slate Navy	#121B3A
UI Tint / Hover	Muted Navy	#1C2951
2. The Orange Palette (Accents & CTAs)
Orange is a high-energy color. Use the "Vivid" shade for primary buttons and the "Soft" version for subtle highlights or secondary badges.
Usage	Color Name	Hex Code
Primary Accent	Atgeir Orange	#F26522
Dark Hover	Burnt Orange	#D14D0E
Secondary Accent	Amber	#F78F54
Soft Highlight	Peach Tint	#FFDBC7
3. The Neutral Palette (Typography & UI Elements)
A professional UI needs more than just pure white. Use "Ghost White" for body text to reduce eye strain on dark backgrounds.
Usage	Color Name	Hex Code
Primary Text	Pure White	#FFFFFF
Secondary Text	Ghost White	#F8F9FA
UI Borders	Light Gray	#D1D3D4
Tertiary/Disabled	Smoke Gray	#939598
UI Design Pro-Tips for this Palette
The 60-30-10 Rule: Use Deep Navy for 60% of the space (backgrounds), White/Gray for 30% (content containers and text), and Orange for 10% (only for the most important buttons or icons).
Contrast is King: Ensure your Orange buttons have White or Deep Navy text inside them to pass accessibility standards (WCAG). Orange on white can sometimes be hard to read; try using a slightly darker orange for text links.
Avoid "Pure" Black: Stick to your #050C26 Navy instead of #000000. It feels much more high-end and modern.
Subtle Gradients: For a "decent" look, try a very subtle linear gradient on buttons from #F26522 to #D14D0E. It adds a professional 3D touch without looking dated.
To create a high-end tech UI, you need to transition between a Deep Night mode and a Crisp Tech light mode. Here is a comprehensive layout and style guide tailored to the Atgeir palette.
1. Font Pairings (The "Tech" Look)
For a professional tech feel, you need high-readability sans-serif fonts:
Primary (Headings): Inter or Montserrat (Bold). These are geometric and modern.
Secondary (Body): Roboto or Open Sans (Regular/Medium). These are highly legible for data and descriptions.
2. UI Color Combinations (The "Tile" System)
This is how you layer your backgrounds, tiles (cards), and buttons to maintain the Atgeir theme.
Element	Dark Mode (The Atgeir Default)	Light Mode (The Professional Clean)
Main Background	#050C26 (Deep Navy)	#F8F9FA (Ghost White)
Tile/Card	#121B3A (Slate Navy)	#FFFFFF (Pure White)
Tile Border	#1C2951 (Muted Navy)	#E9ECEF (Soft Gray)
Primary Button	#F26522 (Atgeir Orange)	#F26522 (Atgeir Orange)
Button Text	#FFFFFF (White)	#FFFFFF (White)
Secondary Text	#D1D3D4 (Light Gray)	#495057 (Deep Gray)
3. Shadows & Depth
To make tiles look "decent and professional," avoid heavy black shadows.
Dark Mode Shadow: Use a glow-style shadow rather than a dark one.
rgba(0, 0, 0, 0.5) with a spread of 15px.
Pro Tip: Add a 1px border in #1C2951 to the tile to make it "pop" without needing a heavy shadow.
Light Mode Shadow: Use a very soft, large-spread shadow.
rgba(5, 12, 38, 0.08) (A tiny bit of your Navy base mixed into the shadow).
This makes the shadow feel "natural" to the theme.
4. Animation & Interactive Effects
The "Atgeir Lift" (Hover): When hovering over a tile, it should lift 4px up (translateY(-4px)) and the shadow should become slightly more intense.
Button Pulse: On hover, the Orange button should have a very subtle "outer glow" of its own color (#F26522 at 30% opacity).
Micro-interactions: Use a 0.3s Ease-in-Out transition for all hover states. It feels "smooth" rather than "snappy," which adds to the professional feel.
5. Attractive Touches (The "Secret Sauce")
For Dark Mode:
Mesh Gradient: Add a very faint, blurred Orange blob (#F26522 at 5% opacity) in the far corner of the background. It adds a "premium" tech atmosphere.
Glassmorphism: Make your tiles slightly translucent (opacity: 0.9) and add a backdrop-filter: blur(10px).
For Light Mode:
Orange Accents: Use the Orange sparingly—only for the active state of a menu or a "New" badge.
Navy Typography: Instead of pure black text, use your Deep Navy (#050C26) for all headings. It ties the light mode back to the brand identity perfectly.
Mockup Layout Description
Header: Sticky Navy (#050C26) bar with a White logo and Orange "Contact" button.
Hero Section: Large Bold Heading in White. Subtext in Light Gray. One large Orange CTA button with a subtle "Burnt Orange" gradient.
The Grid: 3 columns of Tiles.
In Dark: Slate Navy tiles with 1px Muted Navy borders.
In Light: Pure White tiles with soft Navy-tinted shadows.
Buttons: Rounded corners (8px radius). On hover, the button scales up by 1.05x.
 the CSS code snippets for these shadows and hover effects:
To implement the Atgeir tech-focused UI with Poppins for headings and Inter for body text, use these professional CSS snippets. They include variables for easy switching between Light and Dark modes.
1. The Foundation: Typography & Color Variables
Paste this into your global CSS file. It defines the "Atgeir Navy" and "Atgeir Orange" palettes for both modes.
css
@import url('https://googleapis.com');

:root {
  /* Atgeir Brand Colors */
  --atgeir-orange: #F26522;
  --atgeir-orange-hover: #D14D0E;
  --atgeir-navy: #050C26;
  
  /* Fonts */
  --font-heading: 'Poppins', sans-serif;
  --font-body: 'Inter', sans-serif;

  /* Default: Dark Mode (Atgeir Standard) */
  --bg-main: var(--atgeir-navy);
  --bg-tile: #121B3A;
  --border-tile: #1C2951;
  --text-primary: #FFFFFF;
  --text-secondary: #D14D0E; /* Muted text */
  --shadow-color: rgba(0, 0, 0, 0.4);
}

[data-theme="light"] {
  /* Light Mode Overrides */
  --bg-main: #F8F9FA;
  --bg-tile: #FFFFFF;
  --border-tile: #E9ECEF;
  --text-primary: var(--atgeir-navy);
  --text-secondary: #495057;
  --shadow-color: rgba(5, 12, 38, 0.08); /* Navy-tinted shadow */
}

body {
  background-color: var(--bg-main);
  color: var(--text-primary);
  font-family: var(--font-body);
  transition: background 0.3s ease;
}

h1, h2, h3 {
  font-family: var(--font-heading);
  letter-spacing: -0.02em;
}
Use code with caution.

2. The Professional "Tile" System
This creates the card layout with the "Atgeir Lift" hover effect.
css
.atgeir-card {
  background: var(--bg-tile);
  border: 1px solid var(--border-tile);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 20px var(--shadow-color);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  cursor: pointer;
}

/* Hover Effect: The "Atgeir Lift" */
.atgeir-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 12px 30px var(--shadow-color);
  border-color: var(--atgeir-orange); /* Subtle brand highlight on hover */
}
Use code with caution.

3. High-Conversion Buttons
Buttons that pop against both Navy and White backgrounds.
css
.btn-primary {
  background-color: var(--atgeir-orange);
  color: #FFFFFF;
  font-family: var(--font-body);
  font-weight: 500;
  padding: 12px 28px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.btn-primary:hover {
  background-color: var(--atgeir-orange-hover);
  box-shadow: 0 0 15px rgba(242, 101, 34, 0.4); /* Brand Glow */
  transform: scale(1.02);
}

/* Pulse animation for key CTAs */
@keyframes pulse-orange {
  0% { box-shadow: 0 0 0 0 rgba(242, 101, 34, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(242, 101, 34, 0); }
  100% { box-shadow: 0 0 0 0 rgba(242, 101, 34, 0); }
}

.btn-pulse {
  animation: pulse-orange 2s infinite;
}
Use code with caution.

4. Interactive "Glass" Touch (Dark Mode Only)
Add this class to your tiles in Dark Mode for that "high-end tech" vibe.
css
.glass-effect {
  background: rgba(18, 27, 58, 0.7); /* Translucent Slate Navy */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
Use code with caution.

How to use this:
Toggle Themes: Use JavaScript to add data-theme="light" to the <html> or <body> tag.
Card Hierarchy: Use the .atgeir-card for services or newsletter blocks.
Visual Interest: In Light Mode, use var(--atgeir-navy) for your Poppins headings to maintain professional authority. In Dark Mode, use White.