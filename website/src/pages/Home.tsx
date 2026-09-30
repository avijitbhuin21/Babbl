import React from "react";
import { Hero } from "../sections/Hero";
import { Features } from "../sections/Features";
import { HowItWorks } from "../sections/HowItWorks";
import { Download } from "../sections/Download";
import { Faq } from "../sections/Faq";

const Home: React.FC = () => (
  <>
    <Hero />
    <Features />
    <HowItWorks />
    <Download />
    <Faq />
  </>
);

export default Home;
