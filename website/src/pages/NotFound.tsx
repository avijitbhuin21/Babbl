import React from "react";
import { Container } from "../components/Container";
import { Action } from "../components/Action";

const NotFound: React.FC = () => (
  <Container className="flex min-h-[60vh] flex-col items-start justify-center py-24">
    <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent/80">404</p>
    <h1 className="mt-4 text-[34px] font-semibold tracking-[-0.03em] md:text-[44px]">
      This page doesn't exist.
    </h1>
    <p className="mt-4 max-w-[46ch] text-[15px] text-text/50">
      The link may be out of date, or the page has moved.
    </p>
    <Action to="/" variant="secondary" size="lg" className="mt-8">
      Back home
    </Action>
  </Container>
);

export default NotFound;
