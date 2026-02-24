"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

const LONG_TEXT = Array.from({ length: 40 }, (_, i) =>
  `### Step ${i + 1}: ${["Configure database", "Set up auth", "Create API routes", "Add middleware", "Write tests", "Deploy to production", "Monitor performance", "Scale infrastructure"][i % 8]}\n` +
  `This is a detailed description of step ${i + 1}. It contains enough text to demonstrate scrolling behavior. ` +
  `We need to verify that this content is scrollable inside a fixed-position modal on iOS Safari. ` +
  `Each step has multiple lines of text to ensure the content overflows the container.`
).join("\n\n");

function TestModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-[#141414] border border-[#2a2a2a] rounded-t-2xl p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 mb-4">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs text-gray-500">Tap outside to close</p>
        </div>
        {children}
        <div className="flex gap-3 shrink-0 mt-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm border border-[#2a2a2a] rounded-xl text-gray-400">Close</button>
          <button onClick={onClose} className="flex-1 py-3 text-sm bg-green-600 rounded-xl text-white">Allow</button>
        </div>
      </div>
    </div>
  );
}

function PortalModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return createPortal(
    <TestModal title={title} onClose={onClose}>{children}</TestModal>,
    document.body
  );
}

export default function ScrollTestPage() {
  const [activeTest, setActiveTest] = useState<string | null>(null);

  const tests = [
    {
      id: "A",
      label: "A: Current approach (inline, flex)",
      desc: "overflow-y-auto + min-h-0 inside flex-col card (current code)",
    },
    {
      id: "B",
      label: "B: Portal to body",
      desc: "Same CSS but rendered via React Portal at <body> level",
    },
    {
      id: "C",
      label: "C: Fixed height, not flex",
      desc: "Explicit max-h-[60vh] on scroll div, no flex layout",
    },
    {
      id: "D",
      label: "D: No custom scrollbar",
      desc: "Resets ::-webkit-scrollbar override on the scroll container",
    },
  ];

  const scrollContentA = (
    <div className="min-h-0 overflow-y-auto overscroll-contain touch-pan-y bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2.5">
      <code className="text-xs text-gray-300 whitespace-pre-wrap break-words block">{LONG_TEXT}</code>
    </div>
  );

  const scrollContentC = (
    <div className="overflow-y-auto overscroll-contain bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2.5" style={{ maxHeight: "60vh" }}>
      <code className="text-xs text-gray-300 whitespace-pre-wrap break-words block">{LONG_TEXT}</code>
    </div>
  );

  const scrollContentD = (
    <div
      className="min-h-0 overflow-y-auto overscroll-contain touch-pan-y bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2.5"
      style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
    >
      <style>{`
        .no-custom-scrollbar::-webkit-scrollbar { width: initial !important; }
        .no-custom-scrollbar::-webkit-scrollbar-track { background: initial !important; }
        .no-custom-scrollbar::-webkit-scrollbar-thumb { background: initial !important; border-radius: initial !important; }
      `}</style>
      <code className="text-xs text-gray-300 whitespace-pre-wrap break-words block no-custom-scrollbar">{LONG_TEXT}</code>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4">
      <h1 className="text-lg font-bold mb-2">Scroll Test</h1>
      <p className="text-sm text-gray-400 mb-6">Tap each button. Try scrolling the content area in each modal. Report which ones work.</p>

      <div className="space-y-3">
        {tests.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTest(t.id)}
            className="w-full text-left p-4 bg-[#141414] border border-[#2a2a2a] rounded-xl"
          >
            <div className="text-sm font-medium">{t.label}</div>
            <div className="text-xs text-gray-500 mt-1">{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Test A: Current approach — inline modal */}
      {activeTest === "A" && (
        <TestModal title="Test A: Current approach (inline)" onClose={() => setActiveTest(null)}>
          {scrollContentA}
        </TestModal>
      )}

      {/* Test B: Portal to body */}
      {activeTest === "B" && (
        <PortalModal title="Test B: Portal to body" onClose={() => setActiveTest(null)}>
          {scrollContentA}
        </PortalModal>
      )}

      {/* Test C: Fixed height, no flex */}
      {activeTest === "C" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setActiveTest(null)}>
          <div
            className="w-full max-w-lg bg-[#141414] border border-[#2a2a2a] rounded-t-2xl p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <h3 className="text-sm font-semibold">Test C: Fixed height, no flex</h3>
              <p className="text-xs text-gray-500">Tap outside to close</p>
            </div>
            {scrollContentC}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setActiveTest(null)} className="flex-1 py-3 text-sm border border-[#2a2a2a] rounded-xl text-gray-400">Close</button>
              <button onClick={() => setActiveTest(null)} className="flex-1 py-3 text-sm bg-green-600 rounded-xl text-white">Allow</button>
            </div>
          </div>
        </div>
      )}

      {/* Test D: No custom scrollbar override */}
      {activeTest === "D" && (
        <TestModal title="Test D: No custom scrollbar" onClose={() => setActiveTest(null)}>
          {scrollContentD}
        </TestModal>
      )}
    </div>
  );
}
