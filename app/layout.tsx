import type { Metadata } from 'next';
import './globals.css';
import './post-ace.css';

export const metadata: Metadata = {
  title: 'mosheng.18',
  description: '一场为老队友准备的私人任务。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
