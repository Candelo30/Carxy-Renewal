# Implementation Plan: Admin Panel & Theme System

## Overview
This plan addresses two main issues:
1. **Appearance - System mode missing**: Add dark mode / system theme support
2. **Admin panel - Details, design adjustments, and functionality**: Enhance the admin dashboard

---

## BLOCK 1: System Theme / Dark Mode Support

### Issue
The application uses CSS variables for theming but has no mechanism to switch between light/dark/system modes. The CSS variables like `--surface-main`, `--surface-panel`, `--text-primary`, and `--accent-color` are defined but there's no theme toggle.

### Tasks

#### 1.1 Add CSS variables for dark mode
- Update `src/app/shared/components/shell-header/shell-header.css` to include dark mode variables
- Add CSS media query for `prefers-color-scheme`
- Define color schemes for both light and dark modes

#### 1.2 Create theme service
- Create `src/app/core/services/theme.service.ts` that:
  - Detects system preference via `matchMedia('(prefers-color-scheme: dark)')`
  - Stores user preference in localStorage
  - Provides an observable for theme changes
  - Exposes `theme$` observable (light | dark | system)
  - Provides `setTheme(mode)` method

#### 1.3 Add theme toggle to shell header
- Add theme selector to `src/app/shared/components/shell-header/shell-header.html`
- Add theme toggle button in the header actions area
- Support toggling between: Light → Dark → System → Light

#### 1.4 Apply theme to admin dashboard
- Update `src/app/features/admin/admin-dashboard.css` to use theme-aware variables
- Ensure admin panel respects the current theme

#### 1.5 Add translations for theme options
- Add translation keys in translation files for:
  - "theme.light"
  - "theme.dark" 
  - "theme.system"

---

## BLOCK 2: Admin Panel Enhancements

### Issue 2a: Design Details
The admin panel needs visual improvements and better polish.

#### 2.1 Improve sidebar design
- Add hover effects and active state improvements to `admin-dashboard.css`
- Add separator lines between nav items
- Improve the sidebar brand area with better typography

#### 2.2 Enhance panel headers
- Add subtle shadow and elevation to panel headers
- Improve the panel title typography
- Add divider lines between sections

#### 2.3 Improve stats cards
- Add icon color classes (already partially exist)
- Add clickable state support for stats
- Improve hover effects with box-shadow

#### 2.4 Enhance table designs
- Add striped row alternation
- Improve focus states for keyboard navigation
- Add better hover transitions

### Issue 2b: Functionality Enhancements

#### 2.1 Add bulk actions to users table
- Add selection checkboxes to user rows
- Add "Select all" checkbox in header
- Add bulk delete/suspend functionality (already partially exists in TS)

#### 2.2 Add bulk actions to posts/content
- Add selection capability for posts
- Add bulk delete functionality

#### 2.3 Add filtering and search improvements
- Enhance existing search across all tabs
- Add status filters for reports and feedback

#### 2.4 Add project management panel
- The `projects` tab exists but needs UI improvements
- Add project cards with member avatars
- Add role assignment interface

#### 2.5 Add help articles management
- Improve the help articles tab UI
- Add publish/unpublish toggles
- Add category-based filtering

### Issue 2c: Layout Adjustments

#### 2.6 Make admin responsive improvements
- Fix responsive behavior at different breakpoints
- Improve the moderation grid layout
- Adjust sidebar collapse behavior

#### 2.7 Add keyboard navigation support
- Add focus-visible styles
- Improve tab ordering
- Add shortcut keys notation

#### 2.8 Improve empty states
- Add better empty state illustrations/messages
- Add CTA (Call to Action) for when no data is available

---

## BLOCK 3: Implementation Order

### Phase 1: Foundation (Theme System)
1. Create theme service
2. Add CSS variables for dark mode
3. Add system preference detection
4. Basic theme toggle UI

### Phase 2: Admin Panel Design
1. Improve sidebar design
2. Enhance panel headers
3. Improve stats cards
4. Table design improvements

### Phase 3: Admin Panel Functionality
1. Bulk actions for users
2. Bulk actions for posts
3. Enhanced filtering
4. Project management UI
5. Help articles management

### Phase 4: Refinement
1. Responsive adjustments
2. Keyboard navigation
3. Empty state improvements
4. Translation keys

---

## CSS Variable Scheme

### Light Mode (default)
```css
:root {
  --surface-main: #fafafa;
  --surface-panel: #ffffff;
  --surface-raised: #f5f5f5;
  --surface-control: #e0e0e0;
  --border-color: #d1d1d1;
  --text-primary: #1a1a1a;
  --text-muted: #666666;
  --accent-color: #3b82f6;
}
```

### Dark Mode
```css
.dark-mode {
  --surface-main: #121212;
  --surface-panel: #1e1e1e;
  --surface-raised: #252525;
  --surface-control: #3a3a3a;
  --border-color: #4a4a4a;
  --text-primary: #fafafa;
  --text-muted: #b0b0b0;
  --accent-color: #60a5fa;
}
```

### System Mode
```css
@media (prefers-color-scheme: dark) {
  :not(.light-mode):not(.dark-mode) {
    --surface-main: #121212;
    --surface-panel: #1e1e1e;
    --surface-raised: #252525;
    --surface-control: #3a3a3a;
    --border-color: #4a4a4a;
    --text-primary: #fafafa;
    --text-muted: #b0b0b0;
    --accent-color: #60a5fa;
  }
}
```