/**
 * WelcomeStep — First onboarding screen introducing Aionima.
 * Rooted in Impactivism — feeling-first, mission-driven copy.
 */

import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";

interface Props {
  onNext: () => void;
}

const BENEFITS = [
  {
    title: "Make the invisible visible",
    description:
      "The world hides its true costs — poverty, exploitation, harm — behind spreadsheets and quarterly reports. Aionima measures what actually matters: real impact on real people.",
    accent: "text-peach",
  },
  {
    title: "Your voice, everywhere",
    description:
      "Connect every channel — Telegram, Discord, Signal, WhatsApp, Email — into one presence. Never miss a conversation that could change someone's trajectory.",
    accent: "text-blue",
  },
  {
    title: "A network that can't die",
    description:
      "Like mycelium beneath the forest floor, Aionima builds a living knowledge network from your conversations, ideas, and actions — growing stronger with every exchange, surviving every storm.",
    accent: "text-green",
  },
] as const;

export function WelcomeStep({ onNext }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] md:min-h-[70vh] py-6 sm:py-8">
      {/* Logo — fades in with glow */}
      <div className="mb-6 sm:mb-8 onboard-animate-scale onboard-logo-glow">
        <img
          src="/spore-seed-clear.svg"
          alt="Aionima"
          className="w-28 h-auto sm:w-36 md:w-44"
        />
      </div>

      {/* Heading — fades up */}
      <div className="text-center mb-8 sm:mb-10 onboard-animate-in onboard-stagger-1">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-3 sm:mb-4">
          Welcome to Aionima
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground max-w-lg mx-auto leading-relaxed">
          Your autonomous impact gateway — a bridge between
          who you are and the change the world needs.
        </p>
      </div>

      {/* Benefit cards — staggered entrance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 w-full max-w-xl sm:max-w-3xl mb-8 sm:mb-10">
        {BENEFITS.map((benefit, i) => (
          <Card
            key={benefit.title}
            className={`py-0 onboard-animate-in onboard-stagger-${i + 2} hover:border-border/80 transition-colors`}
          >
            <CardContent className="p-4 sm:p-5">
              <h3 className={`text-sm font-semibold mb-2 ${benefit.accent}`}>
                {benefit.title}
              </h3>
              <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
                {benefit.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Civicognita badge */}
      <div className="flex items-center gap-2 mb-6 onboard-animate-fade onboard-stagger-4">
        <img
          src="/civicognita-logo.png"
          alt="Civicognita"
          className="w-5 h-5 rounded-full"
        />
        <span className="text-xs text-muted-foreground">
          Powered by Impactivism — a Civicognita initiative
        </span>
      </div>

      {/* CTA — last to appear */}
      <div className="onboard-animate-in onboard-stagger-5">
        <Button size="lg" onClick={onNext} className="w-full sm:w-auto min-w-[200px]">
          Let's begin
        </Button>
      </div>
    </div>
  );
}
