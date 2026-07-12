"use client";

interface BrandFieldProps {
    label: string;
    htmlFor?: string;
    error?: string;
    hint?: string;
    required?: boolean;
    children: React.ReactNode;
}

export function BrandField({
    label,
    htmlFor,
    error,
    hint,
    required,
    children,
}: BrandFieldProps) {
    return (
        <div className="space-y-1.5">
            <label
                htmlFor={htmlFor}
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
            >
                {label}
                {required && (
                    <span className="text-[var(--red)] ml-1" aria-hidden="true">
                        *
                    </span>
                )}
            </label>
            {children}
            {hint && !error && (
                <p className="text-xs text-[var(--text-muted)]">{hint}</p>
            )}
            {error && (
                <p role="alert" className="text-xs text-red-400">
                    {error}
                </p>
            )}
        </div>
    );
}

interface BrandInputProps
    extends React.InputHTMLAttributes<HTMLInputElement> {
    error?: boolean;
}

export function BrandInput({ error, className = "", value, ...props }: BrandInputProps) {
    return (
        <input
            {...props}
            value={value ?? ""}
            className={[
                "w-full h-9 rounded-lg border bg-[var(--surface)] text-sm text-[var(--text-primary)]",
                "placeholder:text-[var(--text-muted)] px-3",
                "focus:outline-none focus:ring-2 focus:ring-[var(--red)] focus:border-transparent",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                error
                    ? "border-red-500/60"
                    : "border-[var(--border)]",
                className,
            ].join(" ")}
        />
    );
}

interface BrandTextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    error?: boolean;
}

export function BrandTextarea({ error, className = "", value, ...props }: BrandTextareaProps) {
    return (
        <textarea
            {...props}
            value={value ?? ""}
            className={[
                "w-full rounded-lg border bg-[var(--surface)] text-sm text-[var(--text-primary)]",
                "placeholder:text-[var(--text-muted)] px-3 py-2 resize-y leading-relaxed",
                "focus:outline-none focus:ring-2 focus:ring-[var(--red)] focus:border-transparent",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                error
                    ? "border-red-500/60"
                    : "border-[var(--border)]",
                className,
            ].join(" ")}
        />
    );
}

interface BrandSelectProps
    extends React.SelectHTMLAttributes<HTMLSelectElement> {
    error?: boolean;
}

export function BrandSelect({ error, className = "", value, children, ...props }: BrandSelectProps) {
    return (
        <select
            {...props}
            value={value ?? ""}
            className={[
                "w-full h-9 rounded-lg border bg-[var(--surface)] text-sm text-[var(--text-primary)]",
                "px-3 pr-8 appearance-none cursor-pointer",
                "focus:outline-none focus:ring-2 focus:ring-[var(--red)] focus:border-transparent",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "bg-[image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238892b0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")] bg-no-repeat bg-[right_10px_center]",
                error ? "border-red-500/60" : "border-[var(--border)]",
                className,
            ].join(" ")}
        >
            {children}
        </select>
    );
}