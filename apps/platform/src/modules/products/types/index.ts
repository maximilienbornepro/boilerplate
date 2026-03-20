export interface Product {
  id: number;
  name: string;
  description: string | null;
  price: number;
  category: string;
  inStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductFormData {
  name: string;
  description?: string;
  price: number;
  category: string;
  inStock?: boolean;
}
