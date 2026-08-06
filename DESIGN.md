# DESIGN.md - Plataforma de Marketing SMS

## Design Tokens

### Color Palette
- Primary Blue: #2563EB (botones principales, enlaces activos, indicadores de estado)
- Primary Hover: #1D4ED8
- Light Blue BG: #EFF6FF (fondos de secciones seleccionadas, badges informativos)
- Surface White: #FFFFFF (tarjetas, modales, inputs)
- Border: #E2E8F0 (bordes de tarjetas, inputs, tablas)
- Text Primary: #1E293B (titulos, contenido principal)
- Text Secondary: #64748B (labels, texto auxiliar, timestamps)
- Success: #10B981 (estado exitoso, confirmaciones)
- Danger: #EF4444 (errores, eliminaciones, estados fallidos)
- Warning: #F59E0B (alertas, estados pendientes)

### Typography
- Font Family: 'Inter', system-ui, sans-serif
- Headings: 600 weight, tight tracking
- Body: 400 weight, 14px base, 1.5 line-height
- Small/Caption: 12px, 500 weight

### Spacing & Layout
- Sidebar width: 260px (desktop), collapsed to icons on mobile
- Content padding: 24px
- Card border-radius: 12px
- Input border-radius: 8px
- Button border-radius: 8px
- Card shadow: 0 1px 3px rgba(0,0,0,0.08)

### Motion
- Transitions: 150ms ease for hover/focus states
- Modal enter: fade + slight scale up
- Page transitions: subtle fade

## Layout
- Fixed left sidebar with navigation
- Top bar with user info and logout
- Main content area with cards/tables
- Responsive: sidebar collapses to hamburger menu on mobile

## Component Patterns
- Tables: striped rows, hover highlight, sticky header
- Forms: floating labels or top-aligned labels, clear validation states
- Modals: centered overlay with backdrop blur
- Toast notifications: top-right, auto-dismiss after 3s
- Badges: rounded pill shape for status indicators

## Design Constraints (No-Go)
- No gradients on buttons (flat colors only)
- No drop shadows heavier than card level
- No neon/saturated accent colors
- No decorative illustrations (use icons only)
