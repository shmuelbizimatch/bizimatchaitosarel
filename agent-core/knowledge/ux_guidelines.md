# UX Guidelines for Claude Agent System

## Overview
This document contains UX improvement guidelines and patterns optimized for Claude's understanding of modern web development best practices.

## Core UX Principles

### 1. Accessibility First
- **WCAG 2.1 AA Compliance**: All improvements must meet or exceed accessibility standards
- **Keyboard Navigation**: Ensure all interactive elements are keyboard accessible
- **Screen Reader Support**: Use semantic HTML and ARIA attributes appropriately
- **Color Contrast**: Maintain minimum 4.5:1 contrast ratio for normal text, 3:1 for large text
- **Focus Management**: Provide clear focus indicators and logical tab order

### 2. Performance Optimization
- **Core Web Vitals**: Optimize for LCP (<2.5s), FID (<100ms), CLS (<0.1)
- **Lazy Loading**: Implement for images and non-critical components
- **Bundle Optimization**: Code splitting and tree shaking
- **Critical CSS**: Inline critical styles to prevent render blocking
- **Resource Hints**: Use preload, prefetch, and preconnect appropriately

### 3. Responsive Design
- **Mobile First**: Design for mobile devices first, then scale up
- **Flexible Layouts**: Use CSS Grid and Flexbox for adaptive layouts
- **Fluid Typography**: Implement responsive font sizes with clamp() or viewport units
- **Touch Targets**: Minimum 44px touch targets for mobile interfaces
- **Breakpoint Strategy**: Use meaningful breakpoints based on content, not devices

## Component-Specific Guidelines

### Buttons
```tsx
// ✅ Good: Accessible button with proper states
<button
  type="button"
  aria-label={ariaLabel}
  disabled={isLoading}
  className={`btn ${variant} ${isLoading ? 'loading' : ''}`}
  onClick={handleClick}
>
  {isLoading ? <Spinner /> : children}
</button>

// ❌ Bad: Inaccessible button
<div onClick={handleClick}>Click me</div>
```

**Best Practices:**
- Use semantic `<button>` elements
- Provide clear labels and ARIA attributes
- Include loading and disabled states
- Minimum 44px touch target
- Clear visual hierarchy (primary vs secondary)

### Forms
```tsx
// ✅ Good: Accessible form with validation
<form onSubmit={handleSubmit}>
  <div className="form-group">
    <label htmlFor="email">Email Address</label>
    <input
      id="email"
      type="email"
      required
      aria-describedby="email-error"
      aria-invalid={!!errors.email}
      value={email}
      onChange={handleEmailChange}
    />
    {errors.email && (
      <div id="email-error" role="alert" className="error">
        {errors.email}
      </div>
    )}
  </div>
</form>
```

**Best Practices:**
- Always associate labels with inputs
- Use appropriate input types
- Provide clear error messages with `role="alert"`
- Include field validation feedback
- Group related fields with `<fieldset>`

### Navigation
```tsx
// ✅ Good: Semantic navigation with ARIA
<nav aria-label="Main navigation">
  <ul>
    <li>
      <a href="/home" aria-current={isActive ? 'page' : undefined}>
        Home
      </a>
    </li>
  </ul>
</nav>
```

**Best Practices:**
- Use semantic `<nav>` elements
- Provide navigation labels
- Indicate current page with `aria-current`
- Ensure keyboard navigation works
- Consider mobile navigation patterns

### Loading States
```tsx
// ✅ Good: Accessible loading state
<div role="status" aria-live="polite">
  {isLoading ? (
    <>
      <Spinner aria-hidden="true" />
      <span className="sr-only">Loading content...</span>
    </>
  ) : (
    content
  )}
</div>
```

**Best Practices:**
- Use `role="status"` for loading indicators
- Provide screen reader announcements
- Show skeleton screens for better perceived performance
- Avoid layout shift during loading

## Visual Design Guidelines

### Typography
- **Font Hierarchy**: Clear distinction between headings, body text, and captions
- **Line Height**: 1.4-1.6 for body text, 1.2-1.3 for headings
- **Line Length**: 45-75 characters for optimal readability
- **Font Weight**: Use appropriate weights for hierarchy (300, 400, 500, 600, 700)

### Color System
- **Primary Colors**: Use consistently for main actions and branding
- **Semantic Colors**: Success (green), warning (yellow), error (red), info (blue)
- **Neutral Colors**: Gray scale for text, borders, and backgrounds
- **Color Blind Friendly**: Don't rely solely on color to convey information

### Spacing
- **8px Grid System**: Use multiples of 8px for consistent spacing
- **White Space**: Use generous white space to improve readability
- **Padding Ratios**: Follow consistent padding ratios (1:2, 1:1.5)

### Interactive Elements
- **Hover States**: Provide clear hover feedback
- **Focus States**: Visible focus indicators that meet contrast requirements
- **Active States**: Show immediate feedback for user interactions
- **Disabled States**: Clear visual indication of disabled elements

## React-Specific Patterns

### State Management
```tsx
// ✅ Good: Clear state with loading and error handling
const [data, setData] = useState(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

// Handle loading states properly
if (loading) return <LoadingSpinner />;
if (error) return <ErrorMessage error={error} />;
if (!data) return <EmptyState />;
```

### Error Boundaries
```tsx
// ✅ Good: Error boundary for graceful failure
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
```

### Performance Optimization
```tsx
// ✅ Good: Memoized component with proper dependencies
const ExpensiveComponent = memo(({ data, onUpdate }) => {
  const processedData = useMemo(() => {
    return processData(data);
  }, [data]);

  const handleUpdate = useCallback((id) => {
    onUpdate(id);
  }, [onUpdate]);

  return <ComplexVisualization data={processedData} onUpdate={handleUpdate} />;
});
```

## Common UX Anti-Patterns to Avoid

### 1. Poor Loading States
- ❌ No loading indicator
- ❌ Layout shift during loading
- ❌ Blocking the entire interface

### 2. Inaccessible Interactions
- ❌ Click handlers on non-interactive elements
- ❌ Missing keyboard navigation
- ❌ No focus management

### 3. Unclear Error States
- ❌ Generic error messages
- ❌ No recovery options
- ❌ Errors without context

### 4. Poor Mobile Experience
- ❌ Tiny touch targets
- ❌ Horizontal scrolling
- ❌ Fixed desktop layouts

## Enhancement Priorities

### High Priority (Critical UX Issues)
1. Accessibility violations (missing labels, keyboard nav)
2. Performance issues (Core Web Vitals)
3. Broken mobile experience
4. Critical user flows (forms, navigation)

### Medium Priority (UX Improvements)
1. Loading state improvements
2. Error handling enhancements
3. Visual hierarchy improvements
4. Micro-interactions

### Low Priority (Polish)
1. Animation improvements
2. Visual refinements
3. Advanced interactions
4. Personalization features

## Implementation Guidelines

### Code Quality
- Use TypeScript for type safety
- Follow React best practices
- Implement proper error boundaries
- Write accessible HTML

### Testing
- Include accessibility tests
- Test keyboard navigation
- Verify responsive behavior
- Performance testing

### Documentation
- Document component APIs
- Include usage examples
- Provide accessibility notes
- Performance considerations

## Framework-Specific Considerations

### Next.js
- Use Image component for optimization
- Implement proper SEO meta tags
- Leverage SSR/SSG for performance
- Use dynamic imports for code splitting

### React Query/SWR
- Implement proper loading states
- Handle error boundaries
- Cache management
- Optimistic updates

### Styling
- CSS Modules or styled-components
- Consistent design tokens
- Responsive utilities
- Dark mode support

This document serves as the foundation for all UX improvements made by the Claude Agent System, ensuring consistent, accessible, and performant user experiences.