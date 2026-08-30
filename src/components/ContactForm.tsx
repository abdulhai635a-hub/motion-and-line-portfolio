"use client";

import { useState, type FormEvent } from "react";

const budgetRanges = ["Under $1,000", "$1,000 – $5,000", "$5,000 – $15,000", "$15,000+", "Not sure yet"];
const projectTypes = ["Character Animation", "Explainer Video", "Motion Graphics", "Game Animation", "Other"];

export default function ContactForm() {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get("name") as string;
    const email = form.get("email") as string;
    const projectType = form.get("projectType") as string;
    const budget = form.get("budget") as string;
    const message = form.get("message") as string;

    const subject = encodeURIComponent(`New project inquiry from ${name}`);
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nProject type: ${projectType}\nBudget: ${budget}\n\n${message}`
    );
    window.location.href = `mailto:hello@motionandline.com?subject=${subject}&body=${body}`;
    setSubmitted(true);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-coral"
          />
        </div>
        <div>
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-coral"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="projectType" className="text-sm font-medium">
            Project type
          </label>
          <select
            id="projectType"
            name="projectType"
            defaultValue={projectTypes[0]}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-coral"
          >
            {projectTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="budget" className="text-sm font-medium">
            Budget range
          </label>
          <select
            id="budget"
            name="budget"
            defaultValue={budgetRanges[0]}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-coral"
          >
            {budgetRanges.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="message" className="text-sm font-medium">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-coral"
          placeholder="Tell me about the project, timeline, and anything you already have (script, brand assets, references)."
        />
      </div>

      <button
        type="submit"
        className="rounded-full bg-coral px-6 py-3 text-sm font-medium text-white transition-transform hover:scale-105"
      >
        Send inquiry
      </button>

      <p className="text-xs text-muted">
        {submitted
          ? "Opening your email client with this filled in — send it over when you're ready."
          : "This opens your email client with the message pre-filled. No data is stored or sent anywhere else."}
      </p>
    </form>
  );
}
