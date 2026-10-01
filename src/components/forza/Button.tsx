import React, { forwardRef } from 'react';
import './ui.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'default';
  size?: 'sm' | 'icon' | 'default';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'sm', className = '', type = 'button', ...props },
  ref
) {
  const sizeClass = size === 'icon' ? 'ui-button-icon' : size === 'sm' ? 'ui-button-sm' : '';
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-button ${sizeClass} ${className}`}
      {...props}
    />
  );
});

export default Button;
