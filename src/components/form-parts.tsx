import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-base font-medium text-foreground">
        {label}
        {required ? <span className="ml-1 text-[color:var(--candlelight)]">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const baseInput =
  "w-full min-h-11 rounded-sm border border-input bg-[color:var(--vault-deep)] px-3 py-2 text-base text-foreground outline-none placeholder:text-[color:var(--ash)] focus:border-ring disabled:opacity-60";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${baseInput} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${baseInput} min-h-[100px] py-2 font-sans leading-relaxed ${props.className ?? ""}`}
    />
  );
}

export function Select({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${baseInput} ${rest.className ?? ""}`}>
      {children}
    </select>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-border bg-card p-4 md:p-6">
      <h2 className="mb-4 font-serif text-[1.5rem] text-foreground">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
