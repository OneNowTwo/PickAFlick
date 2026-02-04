import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Clapperboard } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative max-w-2xl mx-4 p-8 md:p-12 bg-gradient-to-br from-gray-900 to-black border border-primary/20 rounded-2xl shadow-2xl">
        <div className="space-y-6">
          {steps.map((stepItem, index) => (
            <div
              key={index}
              className={`transform transition-all duration-700 ${
                step > index
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl">
                  {stepItem.number}
                </div>
                <p className="text-xl md:text-2xl text-white font-medium pt-2 leading-relaxed">
                  {stepItem.text}
                </p>
              </div>
            </div>
          ))}

          <div
            className={`transform transition-all duration-500 mt-8 ${
              allStepsShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-4"
            }`}
          >
            <Button
              size="lg"
              onClick={onStart}
              disabled={!allStepsShown}
              className="w-full text-lg py-6"
            >
              <Clapperboard className="w-5 h-5 mr-2" />
              Got it! Let's Go
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
