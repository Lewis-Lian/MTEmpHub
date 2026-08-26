import { useMotionValue, useSpring, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

function Pupil({
  size = 12,
  maxDistance = 5,
  pupilColor = "black",
  forceLookX,
  forceLookY,
}: PupilProps) {
  const pupilRef = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  // 弹簧参数对齐原 transition: transform 0.1s ease-out 的跟手感
  const x = useSpring(rawX, { stiffness: 500, damping: 40 });
  const y = useSpring(rawY, { stiffness: 500, damping: 40 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (forceLookX !== undefined && forceLookY !== undefined) {
        rawX.set(forceLookX);
        rawY.set(forceLookY);
        return;
      }
      if (!pupilRef.current) return;
      const pupil = pupilRef.current.getBoundingClientRect();
      const deltaX = event.clientX - (pupil.left + pupil.width / 2);
      const deltaY = event.clientY - (pupil.top + pupil.height / 2);
      const distance = Math.min(Math.hypot(deltaX, deltaY), maxDistance);
      const angle = Math.atan2(deltaY, deltaX);
      rawX.set(Math.cos(angle) * distance);
      rawY.set(Math.sin(angle) * distance);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [forceLookX, forceLookY, maxDistance, rawX, rawY]);

  return (
    <motion.div
      ref={pupilRef}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        borderRadius: "999px",
        x,
        y,
      }}
    />
  );
}

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

function EyeBall({
  size = 48,
  pupilSize = 16,
  maxDistance = 10,
  eyeColor = "white",
  pupilColor = "black",
  isBlinking = false,
  forceLookX,
  forceLookY,
}: EyeBallProps) {
  const eyeRef = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, { stiffness: 500, damping: 40 });
  const y = useSpring(rawY, { stiffness: 500, damping: 40 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (forceLookX !== undefined && forceLookY !== undefined) {
        rawX.set(forceLookX);
        rawY.set(forceLookY);
        return;
      }
      if (!eyeRef.current) return;
      const eye = eyeRef.current.getBoundingClientRect();
      const deltaX = event.clientX - (eye.left + eye.width / 2);
      const deltaY = event.clientY - (eye.top + eye.height / 2);
      const distance = Math.min(Math.hypot(deltaX, deltaY), maxDistance);
      const angle = Math.atan2(deltaY, deltaX);
      rawX.set(Math.cos(angle) * distance);
      rawY.set(Math.sin(angle) * distance);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [forceLookX, forceLookY, maxDistance, rawX, rawY]);

  return (
    <div
      ref={eyeRef}
      style={{
        width: `${size}px`,
        height: isBlinking ? "2px" : `${size}px`,
        backgroundColor: eyeColor,
        borderRadius: "999px",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.15s ease",
      }}
    >
      {!isBlinking ? (
        <motion.div
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            borderRadius: "999px",
            x,
            y,
          }}
        />
      ) : null}
    </div>
  );
}

interface AnimatedCharactersProps {
  isTyping?: boolean;
  showPassword?: boolean;
  passwordLength?: number;
}

export default function AnimatedCharacters({
  isTyping = false,
  showPassword = false,
  passwordLength = 0,
}: AnimatedCharactersProps) {
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setMouseX(event.clientX);
      setMouseY(event.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    let blinkTimer = 0;
    let resetTimer = 0;

    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setIsPurpleBlinking(true);
        resetTimer = window.setTimeout(() => {
          setIsPurpleBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
    };

    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(resetTimer);
    };
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;
    let blinkTimer = 0;
    let resetTimer = 0;

    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setIsBlackBlinking(true);
        resetTimer = window.setTimeout(() => {
          setIsBlackBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());
    };

    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(resetTimer);
    };
  }, []);

  useEffect(() => {
    if (!isTyping) {
      setIsLookingAtEachOther(false);
      return;
    }

    setIsLookingAtEachOther(true);
    const timer = window.setTimeout(() => setIsLookingAtEachOther(false), 800);
    return () => window.clearTimeout(timer);
  }, [isTyping]);

  useEffect(() => {
    if (!(passwordLength > 0 && showPassword)) {
      setIsPurplePeeking(false);
      return;
    }

    let intervalTimer = 0;
    let resetTimer = 0;

    const schedulePeek = () => {
      intervalTimer = window.setTimeout(() => {
        setIsPurplePeeking(true);
        resetTimer = window.setTimeout(() => {
          setIsPurplePeeking(false);
          schedulePeek();
        }, 800);
      }, Math.random() * 3000 + 2000);
    };

    schedulePeek();
    return () => {
      window.clearTimeout(intervalTimer);
      window.clearTimeout(resetTimer);
    };
  }, [passwordLength, showPassword]);

  const calculatePosition = (ref: React.RefObject<HTMLDivElement>) => {
    if (!ref.current) {
      return { faceX: 0, faceY: 0, bodySkew: 0 };
    }

    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3;
    const deltaX = mouseX - centerX;
    const deltaY = mouseY - centerY;

    return {
      faceX: Math.max(-15, Math.min(15, deltaX / 20)),
      faceY: Math.max(-10, Math.min(10, deltaY / 30)),
      bodySkew: Math.max(-6, Math.min(6, -deltaX / 120)),
    };
  };

  const purplePos = calculatePosition(purpleRef);
  const blackPos = calculatePosition(blackRef);
  const yellowPos = calculatePosition(yellowRef);
  const orangePos = calculatePosition(orangeRef);
  const isHidingPassword = passwordLength > 0 && !showPassword;

  return (
    <div style={{ position: "relative", width: "550px", height: "400px" }}>
      <div
        ref={purpleRef}
        data-testid="animated-purple-character"
        style={{
          position: "absolute",
          bottom: 0,
          left: "70px",
          width: "180px",
          height: isTyping || isHidingPassword ? "440px" : "400px",
          backgroundColor: "#6C3FF5",
          borderRadius: "10px 10px 0 0",
          zIndex: 1,
          transform:
            passwordLength > 0 && showPassword
              ? "skewX(0deg)"
              : isTyping || isHidingPassword
                ? `skewX(${purplePos.bodySkew - 12}deg) translateX(40px)`
                : `skewX(${purplePos.bodySkew}deg)`,
          transformOrigin: "bottom center",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          data-testid="animated-purple-eyes"
          style={{
            position: "absolute",
            left: passwordLength > 0 && showPassword ? "20px" : isLookingAtEachOther ? "55px" : `${45 + purplePos.faceX}px`,
            top: passwordLength > 0 && showPassword ? "35px" : isLookingAtEachOther ? "65px" : `${40 + purplePos.faceY}px`,
            display: "flex",
            gap: "32px",
            transition: "all 0.7s ease-in-out",
          }}
        >
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isPurpleBlinking}
            forceLookX={passwordLength > 0 && showPassword ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
          />
          <EyeBall
            size={18}
            pupilSize={7}
            maxDistance={5}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isPurpleBlinking}
            forceLookX={passwordLength > 0 && showPassword ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
          />
        </div>
      </div>

      <div
        ref={blackRef}
        data-testid="animated-black-character"
        style={{
          position: "absolute",
          bottom: 0,
          left: "240px",
          width: "120px",
          height: "310px",
          backgroundColor: "#2D2D2D",
          borderRadius: "8px 8px 0 0",
          zIndex: 2,
          transform:
            passwordLength > 0 && showPassword
              ? "skewX(0deg)"
              : isLookingAtEachOther
                ? `skewX(${blackPos.bodySkew * 1.5 + 10}deg) translateX(20px)`
                : isTyping || isHidingPassword
                  ? `skewX(${blackPos.bodySkew * 1.5}deg)`
                  : `skewX(${blackPos.bodySkew}deg)`,
          transformOrigin: "bottom center",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          data-testid="animated-black-eyes"
          style={{
            position: "absolute",
            left: passwordLength > 0 && showPassword ? "10px" : isLookingAtEachOther ? "32px" : `${26 + blackPos.faceX}px`,
            top: passwordLength > 0 && showPassword ? "28px" : isLookingAtEachOther ? "12px" : `${32 + blackPos.faceY}px`,
            display: "flex",
            gap: "24px",
            transition: "all 0.7s ease-in-out",
          }}
        >
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isBlackBlinking}
            forceLookX={passwordLength > 0 && showPassword ? -4 : isLookingAtEachOther ? 0 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? -4 : isLookingAtEachOther ? -4 : undefined}
          />
          <EyeBall
            size={16}
            pupilSize={6}
            maxDistance={4}
            eyeColor="white"
            pupilColor="#2D2D2D"
            isBlinking={isBlackBlinking}
            forceLookX={passwordLength > 0 && showPassword ? -4 : isLookingAtEachOther ? 0 : undefined}
            forceLookY={passwordLength > 0 && showPassword ? -4 : isLookingAtEachOther ? -4 : undefined}
          />
        </div>
      </div>

      <div
        ref={orangeRef}
        data-testid="animated-orange-character"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "240px",
          height: "200px",
          zIndex: 3,
          backgroundColor: "#FF9B6B",
          borderRadius: "120px 120px 0 0",
          transform: passwordLength > 0 && showPassword ? "skewX(0deg)" : `skewX(${orangePos.bodySkew}deg)`,
          transformOrigin: "bottom center",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: passwordLength > 0 && showPassword ? "50px" : `${82 + orangePos.faceX}px`,
            top: passwordLength > 0 && showPassword ? "85px" : `${90 + orangePos.faceY}px`,
            display: "flex",
            gap: "32px",
            transition: "all 0.2s ease-out",
          }}
        >
          <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={passwordLength > 0 && showPassword ? -5 : undefined} forceLookY={passwordLength > 0 && showPassword ? -4 : undefined} />
          <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={passwordLength > 0 && showPassword ? -5 : undefined} forceLookY={passwordLength > 0 && showPassword ? -4 : undefined} />
        </div>
      </div>

      <div
        ref={yellowRef}
        data-testid="animated-yellow-character"
        style={{
          position: "absolute",
          bottom: 0,
          left: "310px",
          width: "140px",
          height: "230px",
          backgroundColor: "#E8D754",
          borderRadius: "70px 70px 0 0",
          zIndex: 4,
          transform: passwordLength > 0 && showPassword ? "skewX(0deg)" : `skewX(${yellowPos.bodySkew}deg)`,
          transformOrigin: "bottom center",
          transition: "all 0.7s ease-in-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: passwordLength > 0 && showPassword ? "20px" : `${52 + yellowPos.faceX}px`,
            top: passwordLength > 0 && showPassword ? "35px" : `${40 + yellowPos.faceY}px`,
            display: "flex",
            gap: "24px",
            transition: "all 0.2s ease-out",
          }}
        >
          <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={passwordLength > 0 && showPassword ? -5 : undefined} forceLookY={passwordLength > 0 && showPassword ? -4 : undefined} />
          <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={passwordLength > 0 && showPassword ? -5 : undefined} forceLookY={passwordLength > 0 && showPassword ? -4 : undefined} />
        </div>
        <div
          style={{
            position: "absolute",
            left: passwordLength > 0 && showPassword ? "10px" : `${40 + yellowPos.faceX}px`,
            top: passwordLength > 0 && showPassword ? "88px" : `${88 + yellowPos.faceY}px`,
            width: "80px",
            height: "4px",
            backgroundColor: "#2D2D2D",
            borderRadius: "999px",
            transition: "all 0.2s ease-out",
          }}
        />
      </div>
    </div>
  );
}
