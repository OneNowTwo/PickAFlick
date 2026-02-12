import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface GameInstructionsProps {
  onStart: () => void;
}

const INSTRUCTIONS_SEEN_KEY = "whatwewatching_instructions_seen";

export function GameInstructions({ onStart }: GameInstructionsProps) {
  const [step, setStep] = useState(0);
  const [allStepsShown, setAllStepsShown] = useState(false);
  const [shouldShow, setShouldShow] = useState(true);

  useEffect(() => {
    // Check if user has seen instructions before
    const hasSeenInstructions = localStorage.getItem(INSTRUCTIONS_SEEN_KEY);
    if (hasSeenInstructions === "true") {
      setShouldShow(false);
      onStart(); // Skip straight to game
      return;
    }

    // Show step 1 immediately
    const timer1 = setTimeout(() => setStep(1), 100);
    
    // Show step 2 after 1.5 seconds
    const timer2 = setTimeout(() => setStep(2), 1600);
    
    // Show step 3 after 3 seconds
    const timer3 = setTimeout(() => setStep(3), 3100);
    
    // Show step 4 after 4.5 seconds
    const timer4 = setTimeout(() => setStep(4), 4600);
    
    // Show step 5 after 6 seconds
    const timer5 = setTimeout(() => {
      setStep(5);
      setAllStepsShown(true);
    }, 6100);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      clearTimeout(timer5);
    };
  }, [onStart]);

  const handleGotIt = () => {
    // Mark instructions as seen
    localStorage.setItem(INSTRUCTIONS_SEEN_KEY, "true");
    onStart();
  };

  if (!shouldShow) {
    return null;
  }

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
    {
      number: "4",
      text: "Like a movie? Click the bookmark icon to save it to your watchlist",
    },
    {
      number: "5",
      text: "Ready to watch? Click on any streaming service to start viewing. No more choice paralysis - just pick one and enjoy! 🍿",
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
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                  <span className="text-primary font-bold text-lg">
                    {stepItem.number}
                  </span>
                </div>
                <p className="text-xl text-white font-bold pt-1.5 leading-relaxed">
                  {stepItem.text}
                </p>
              </div>
            </div>
          ))}

          <div
            className={`transform transition-all duration-500 pt-4 flex justify-center ${
              allStepsShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-4"
            }`}
          >
            <Button
              onClick={handleGotIt}
              disabled={!allStepsShown}
              className="text-base h-10 px-12 hover:scale-105 hover:brightness-110 transition-all"
            >
              Got it
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
