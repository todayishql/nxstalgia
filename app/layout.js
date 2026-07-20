import './globals.css';

export const metadata = {
  title: 'THE N[26]stalgia — Admin',
  description: 'Chart data administration',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}