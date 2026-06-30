import NextAuth, { NextAuthOptions, Session } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { JWT } from 'next-auth/jwt';
import { getUserByEmail } from './sheets';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string;
      role: 'Pengawas' | 'Master Admin';
    };
    accessToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'Pengawas' | 'Master Admin';
    accessToken?: string;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/drive',
          prompt: 'consent',
          access_type: 'offline',
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      // Dev mode: no Sheets configured — allow all logins
      if (!process.env.SPREADSHEET_ID) {
        console.warn('[AUTH] SPREADSHEET_ID not set — dev mode: allowing all logins');
        return true;
      }

      try {
        const appUser = await getUserByEmail(user.email);
        if (!appUser) {
          return '/login?error=unregistered';
        }
        return true;
      } catch (err) {
        console.error('[AUTH] signIn check failed:', err);
        return false;
      }
    },

    async jwt({ token, user, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      // On initial sign in, fetch role from Sheets
      if (user?.email) {
        if (!process.env.SPREADSHEET_ID) {
          // Dev mode: assign Master Admin
          token.role = 'Master Admin';
        } else {
          try {
            const appUser = await getUserByEmail(user.email);
            token.role = appUser?.role ?? 'Pengawas';
          } catch {
            token.role = 'Pengawas';
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role ?? 'Pengawas';
        session.user.id = token.sub ?? session.user.email;
        session.accessToken = token.accessToken;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
