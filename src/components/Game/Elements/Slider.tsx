import React, { useRef, useEffect, useState } from "react";
import { useSelector } from "@xstate/react";
import Swiper from "swiper";
import { EffectCoverflow } from "swiper/modules";

import { useGameContext } from "#/components/Game/MachineContext";
import Card from "#/components/Game/Elements/Card";

const Slider: React.FC = () => {
  const { sections, machineService } = useGameContext();
  const type = useSelector(machineService, (state) => state.context.type);
  const [activeIndex, setActiveIndex] = useState(0);
  const swiper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (swiper.current) {
      new Swiper(swiper.current, {
        modules: [EffectCoverflow],
        effect: "coverflow",
        grabCursor: true,
        loop: true,
        centeredSlides: true,
        slidesPerView: "auto",
        loopAdditionalSlides: 3,
        slideToClickedSlide: true,
        coverflowEffect: {
          rotate: -5,
          stretch: 0,
          depth: 200,
          modifier: 1,
          slideShadows: false,
        },
        on: {
          realIndexChange: (swiper) => {
            setActiveIndex(swiper.realIndex);
          },
        },
      });
    }
  }, []);

  return (
    <div
      style={{
        maskImage:
          "linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 20%, rgba(0, 0, 0, 1) 80%, rgba(0, 0, 0, 0))",
        WebkitMaskImage:
          "linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 1) 20%, rgba(0, 0, 0, 1) 80%, rgba(0, 0, 0, 0))",
      }}
      ref={swiper}
      className="swiper w-full h-full"
    >
      <div className="swiper-wrapper">
        {[...sections, ...sections]
          .filter((f) => {
            if (type === "solo") {
              return f.character !== "boosted";
            }
            return f;
          })
          .map((section, index) => (
            <div
              key={index}
              className="swiper-slide !w-fit !bg-transparent !flex items-center justify-center"
            >
              <Card data={section} active={activeIndex === index} />
            </div>
          ))}
      </div>
    </div>
  );
};

export default Slider;
