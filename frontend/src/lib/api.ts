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

export interface CorrectionField {
  id: string;
  label: string;
  input?: 'text' | 'number';
  unit?: string;
  step?: string;
  min?: number;
  placeholder?: string;
}

export interface CorrectionDetails {
  kind: 'dimensions' | 'attributes';
  group_key: string;
  summary: string;
  fields: CorrectionField[];
  attribute_ids?: string[];
}

export interface CopyResult {
  source_item_id: string;
  dest_seller: string;
  status: 'success' | 'error' | 'pending' | 'needs_dimensions' | 'needs_correction';
  dest_item_id: string | null;
  error: string | null;
  sku?: string | null;
  correction_details?: CorrectionDetails | null;
}

export interface CopyResponse {
  total: number;
  success: number;
  errors: number;
  needs_dimensions?: number;
  needs_correction?: number;
  results: CopyResult[];
}

export interface CopyQueuedResponse {
  status: 'queued';
  total: number;
  message: string;
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
  correction_details?: CorrectionDetails | null;
  source_item_sku?: string | null;
  source_item_title: string | null;
  source_item_thumbnail: string | null;
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
  weight?: number;
  has_description?: boolean;
  stock?: number;
}

export interface CompatPreview {
  id: string;
  title: string;
  thumbnail: string;
  has_compatibilities: boolean;
  compat_count: number;
  skus: string[];
  seller: string;
}

export interface CompatSearchResult {
  seller_slug: string;
  seller_name: string;
  item_id: string;
  sku: string;
  title: string;
}

export interface Org {
  id: string;
  name: string;
  email: string;
  active: boolean;
  payment_active: boolean;
  created_at: string;
}

export interface OrgWithStats extends Org {
  user_count: number;
  seller_count: number;
  copy_count: number;
  compat_count: number;
  shopee_seller_count: number;
  shopee_copy_count: number;
}

export interface ShopeeSeller {
  slug: string;
  name: string;
  shop_id: number;
  token_valid: boolean;
  token_expires_at: string | null;
  created_at: string;
}

export interface ShopeeCopyLog {
  id: number;
  user_email: string | null;
  source_seller: string;
  dest_sellers: string[];
  source_item_id: string;
  dest_item_ids: Record<string, string>;
  status: string;
  error_details: Record<string, string> | null;
  correction_details?: CorrectionDetails | null;
  source_item_sku?: string | null;
  source_item_title: string | null;
  source_item_thumbnail: string | null;
  created_at: string;
}

export interface ShopeeItemPreview {
  item_id: number;
  item_name: string;
  original_price: number;
  stock: number;
  category_id: number;
  status: string;
  image_url: string;
  image_count: number;
  model_count: number;
  has_description: boolean;
  weight: number;
  shop_slug: string;
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
