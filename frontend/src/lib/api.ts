const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export { API_BASE };

export interface Seller {
  slug: string;
  name: string;
  ml_user_id: number;
  token_valid: boolean;
  token_expires_at: string | null;
  created_at: string;
}

export interface CopyResult {
  source_item_id: string;
  dest_seller: string;
  status: 'success' | 'error' | 'pending';
  dest_item_id: string | null;
  error: string | null;
}

export interface CopyResponse {
  total: number;
  success: number;
  errors: number;
  results: CopyResult[];
}

export interface CopyLog {
  id: number;
  user_email: string | null;
  source_seller: string;
  dest_sellers: string[];
  source_item_id: string;
  dest_item_ids: Record<string, string>;
  status: string;
  error_details: Record<string, string> | null;
  created_at: string;
}

export interface ItemPreview {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  sold_quantity: number;
  category_id: string;
  listing_type_id: string;
  condition: string;
  status: string;
  thumbnail: string;
  permalink: string;
  pictures_count: number;
  variations_count: number;
  attributes_count: number;
  has_compatibilities: boolean;
  description_length: number;
  channels: string[];
}

export interface CompatPreview {
  id: string;
  title: string;
  thumbnail: string;
  has_compatibilities: boolean;
  compat_count: number;
}

export interface CompatSearchResult {
  seller_slug: string;
  seller_name: string;
  item_id: string;
  sku: string;
  title: string;
}

export interface CompatCopyResult {
  total: number;
  success: number;
  errors: number;
  results: {
    seller_slug: string;
    item_id: string;
    status: 'ok' | 'error';
    error: string | null;
  }[];
}
