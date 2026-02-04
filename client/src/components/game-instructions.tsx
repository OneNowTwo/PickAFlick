import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface GameInstructionsProps {
  onStart: () => void;
}

export function GameInstructions({ onStart }: GameInstructionsProps) {
  const [step, setStep] = useState(0);
  const [allStepsShown, setAllStepsShown] = useState(false);

  useEffect(() => {
    // Show step 1 immediately
    const timer1 = setTimeout(() => setStep(1), 100);
    
    // Show step 2 after 1.5 seconds
    const timer2 = setTimeout(() => setStep(2), 1600);
    
    // Show step 3 after 3 seconds
    const timer3 = setTimeout(() => {
      setStep(3);
      setAllStepsShown(true);
    }, 3100);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  const steps = [
    {
      number: "1",
      text: "Pick the poster that catches your eye",
    },
    {
      number: "2",
      text: "Do this 7 times so we can learn your taste",
    },
    {
      number: "3",
      text: "Don't know the film? Trust your gut - you CAN judge a book by its cover! 🎬",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="relative max-w-xl mx-4 p-8 bg-black/90 border border-white/10 rounded-lg">
        <div className="space-y-5">
          {steps.map((stepItem, index) => (
            <div
              key={index}
              className={`transform transition-all duration-700 ${
                step > index
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 text-white/40 font-normal text-lg mt-0.5">
                  {stepItem.number}.
                </span>
                <p className="text-lg text-white/90 font-normal leading-relaxed">
                  {stepItem.text}
                </p>
              </div>
            </div>
          ))}

          <div
            className={`transform transition-all duration-500 pt-4 ${
              allStepsShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-4"
            }`}
          >
            <Button
              onClick={onStart}
              disabled={!allStepsShown}
              className="w-full text-base py-5"
            >
              Got it
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
