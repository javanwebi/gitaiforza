import React, { forwardRef } from 'react';
import './forzaParticle.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'default';
  size?: 'sm' | 'icon' | 'default';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'sm', className = '', type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-button ui-button-${size} ${className}`}
      {...props}
    />
  );
});

export default Button;
