'use client'

import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded-2xl border-2 border-border-soft bg-surface px-4 py-3',
          'text-sm text-text-primary placeholder:text-text-secondary/50',
          'transition-all duration-200',
          'focus:border-primary/30 focus:outline-none focus:ring-4 focus:ring-primary/5',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input }
