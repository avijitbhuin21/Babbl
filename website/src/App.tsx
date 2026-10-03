import React, { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import Home from "./pages/Home";
import Docs from "./pages/Docs";
import DownloadPage from "./pages/Download";
import Changelog from "./pages/Changelog";
import Credits from "./pages/Credits";
import Contact from "./pages/Contact";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";
import seo from "../seo-routes.json";

const ScrollManager: React.FC = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const route = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
    const meta = (seo.routes as Record<string, { title: string; description: string }>)[route];
    if (meta) {
      document.title = meta.title;
      document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
      document.querySelector('link[rel="canonical"]')?.setAttribute("href", `${seo.siteUrl}${route}`);
    }
  }, [pathname]);

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
};

const App: React.FC = () => (
  <div className="flex min-h-screen flex-col">
    <ScrollManager />
    <Header />
    <main className="flex-1">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/credits" element={<Credits />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </main>
    <Footer />
  </div>
);

export default App;
