import { create } from 'zustand';

// Page type constants
export const Pages = {
  LOGIN: 'LOGIN',
  REGISTER: 'REGISTER',
  HOME: 'HOME',
  DASHBOARD: 'DASHBOARD',
  MARKETS: 'MARKETS',
  WATCHLIST: 'WATCHLIST',
  TRADING: 'TRADING',
  SPOT: 'SPOT',
  FUTURES: 'FUTURES',
  WALLET: 'WALLET',
  ASSETS: 'ASSETS',
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
  EARN: 'EARN',
  TRANSACTIONS: 'TRANSACTIONS',
  HISTORY: 'HISTORY',
  PROFILE: 'PROFILE',
  SECURITY: 'SECURITY',
  NOTIFICATIONS: 'NOTIFICATIONS',
  SETTINGS: 'SETTINGS',
  REFERRAL: 'REFERRAL',
  LOCK_SCREEN: 'LOCK_SCREEN',
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  // Admin pages
  ADMIN_DASHBOARD: 'ADMIN_DASHBOARD',
  ADMIN_USERS: 'ADMIN_USERS',
  ADMIN_AGENTS: 'ADMIN_AGENTS',
  ADMIN_TRADES: 'ADMIN_TRADES',
  ADMIN_WALLETS: 'ADMIN_WALLETS',
  ADMIN_DEPOSITS: 'ADMIN_DEPOSITS',
  ADMIN_WITHDRAWALS: 'ADMIN_WITHDRAWALS',
  ADMIN_ANALYTICS: 'ADMIN_ANALYTICS',
  ADMIN_COMMISSIONS: 'ADMIN_COMMISSIONS',
  ADMIN_RISK: 'ADMIN_RISK',
  ADMIN_SETTINGS: 'ADMIN_SETTINGS',
  ADMIN_NOTIFICATIONS: 'ADMIN_NOTIFICATIONS',
  ADMIN_AUDIT: 'ADMIN_AUDIT',
  ADMIN_INVITATIONS: 'ADMIN_INVITATIONS',
} as const;

export type PageType = (typeof Pages)[keyof typeof Pages];

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatar?: string;
  phone?: string;
  agentId?: string;
  mustChangePassword?: boolean;
  passwordChangedAt?: string;
  invitationCode?: string;
  lastLogin?: string;
  createdAt?: string;
}

interface StoreState {
  currentPage: PageType;
  pageHistory: PageType[];
  user: UserInfo | null;
  token: string | null;
  isAuthenticated: boolean;
  notifications: Record<string, unknown>[];
  unreadCount: number;
  sidebarOpen: boolean;
  loading: boolean;
  selectedCoin?: string;
  
  // Actions
  navigate: (page: PageType) => void;
  goBack: () => void;
  setAuth: (user: UserInfo, token: string) => void;
  logout: () => void;
  setNotifications: (notifications: any[]) => void;
  setUnreadCount: (count: number) => void;
  toggleSidebar: () => void;
  setLoading: (loading: boolean) => void;
  setSelectedCoin: (coin: string) => void;
}

const TOKEN_KEY = 'brock_token';
const USER_KEY = 'brock_user';

export const useStore = create<StoreState>((set, get) => ({
  currentPage: Pages.HOME,
  pageHistory: [Pages.HOME],
  user: null,
  token: null,
  isAuthenticated: false,
  notifications: [],
  unreadCount: 0,
  sidebarOpen: true,
  loading: false,

  navigate: (page) => {
    const { currentPage, pageHistory } = get();
    set({
      currentPage: page,
      pageHistory: [...pageHistory.slice(-19), currentPage],
    });
  },

  goBack: () => {
    const { pageHistory } = get();
    if (pageHistory.length > 1) {
      const newHistory = pageHistory.slice(0, -1);
      const prevPage = newHistory[newHistory.length - 1];
      set({ currentPage: prevPage, pageHistory: newHistory });
    }
  },

  setAuth: (user, token) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'SUB_AGENT';
    // If mustChangePassword, force redirect to change password page
    const startPage = user.mustChangePassword
      ? Pages.CHANGE_PASSWORD
      : (isAdmin ? Pages.ADMIN_DASHBOARD : Pages.DASHBOARD);
    set({
      user,
      token,
      isAuthenticated: true,
      currentPage: startPage,
      pageHistory: [startPage],
    });
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      currentPage: Pages.HOME,
      pageHistory: [Pages.HOME],
      notifications: [],
      unreadCount: 0,
    });
  },

  setNotifications: (notifications) => {
    const unread = notifications.filter((n: any) => !n.read).length;
    set({ notifications, unreadCount: unread });
  },

  setUnreadCount: (count) => set({ unreadCount: count }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  setLoading: (loading) => set({ loading }),

  setSelectedCoin: (coin) => set({ selectedCoin: coin }),
}));

// Hydrate from localStorage (check both old and new keys for migration)
if (typeof window !== 'undefined') {
  const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('nextrade_token');
  const userStr = localStorage.getItem(USER_KEY) || localStorage.getItem('nextrade_user');
  if (token && userStr) {
    // Migrate old keys to new keys
    if (localStorage.getItem('nextrade_token')) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem('nextrade_token');
    }
    if (localStorage.getItem('nextrade_user')) {
      localStorage.setItem(USER_KEY, userStr);
      localStorage.removeItem('nextrade_user');
    }
    try {
      const user = JSON.parse(userStr);
      const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'SUB_AGENT';
      useStore.setState({
        user,
        token,
        isAuthenticated: true,
        currentPage: isAdmin ? Pages.ADMIN_DASHBOARD : Pages.DASHBOARD,
        pageHistory: [isAdmin ? Pages.ADMIN_DASHBOARD : Pages.DASHBOARD],
      });
    } catch {}
  }
}

export default useStore;