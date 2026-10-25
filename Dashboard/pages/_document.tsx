import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var saved=localStorage.getItem("color-scheme");var meta=document.querySelector('meta[name="color-scheme"]');if(saved==="light"||saved==="dark"||saved==="light dark"){if(meta)meta.setAttribute("content",saved);if(saved==="light"||saved==="dark"){document.documentElement.setAttribute("data-theme",saved);}else{document.documentElement.removeAttribute("data-theme");}}}catch(e){}})();`
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
